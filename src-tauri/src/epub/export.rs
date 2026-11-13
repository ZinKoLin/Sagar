//! Export: rebuilds a translated EPUB from the immutable snapshot by
//! patching translated block fragments into copies of the original
//! resources. The snapshot is never modified; the output is written to a
//! temporary file and validated before it replaces the destination.

use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::Path;

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::domain::{ExportOutcome, ImportWarning};
use crate::epub::archive::SafeArchive;
use crate::epub::{container, opf, patch};
use crate::error::AppError;
use crate::security::ArchiveLimits;
use crate::storage::translations::BlockForExport;

pub const MIMETYPE: &str = "application/epub+zip";

/// Builds the output archive from `snapshot_path` with the given patched
/// resources (ZIP-root path → bytes) and writes it to `destination`.
/// Entries in `excluded` are omitted entirely so untranslated original
/// content never leaks into a translated-only draft.
fn write_archive(
    snapshot_path: &Path,
    patched: &HashMap<String, Vec<u8>>,
    excluded: &HashSet<String>,
    destination: &Path,
) -> Result<(), AppError> {
    let mut source = SafeArchive::open(snapshot_path, &ArchiveLimits::default())?;
    let tmp_destination = destination.with_file_name(format!(
        ".{}.tmp-{}",
        destination
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("export"),
        uuid::Uuid::new_v4()
    ));
    let file = std::fs::File::create(&tmp_destination)?;
    let mut writer = ZipWriter::new(file);
    let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let deflated = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    writer
        .start_file("mimetype", stored)
        .map_err(|_| AppError::new("export_failed", "Cannot write EPUB declaration."))?;
    writer.write_all(MIMETYPE.as_bytes())?;
    // This list excludes ZIP directory entries; its positions are not raw
    // archive indices. Copy by validated name so trailing files are retained.
    let names = source.entry_names_ordered().to_vec();
    for name in names {
        if name == "mimetype" {
            continue;
        }
        if excluded.contains(&name) {
            continue;
        }
        let bytes = source.read_entry(&name)?;
        let contents = patched.get(&name).map(Vec::as_slice).unwrap_or(&bytes);
        let options = if name == "mimetype" { stored } else { deflated };
        writer.start_file(name.as_str(), options).map_err(|_| {
            AppError::new("export_failed", "The output archive could not be written.")
        })?;
        writer.write_all(contents).map_err(|_| {
            AppError::new("export_failed", "The output archive could not be written.")
        })?;
    }
    for (name, bytes) in patched {
        if !source.contains(name) {
            writer
                .start_file(name, deflated)
                .map_err(|_| AppError::new("export_failed", "Cannot write image resource."))?;
            writer.write_all(bytes)?;
        }
    }
    writer
        .finish()
        .map_err(|_| AppError::new("export_failed", "The output archive could not be written."))?;
    if let Err(error) = validate_output(&tmp_destination) {
        let _ = std::fs::remove_file(&tmp_destination);
        return Err(error);
    }
    std::fs::rename(&tmp_destination, destination)?;
    Ok(())
}

/// Structural validation of a produced EPUB: OCF order, package document,
/// manifest targets, spine and chapter XML well-formedness.
pub fn validate_output(path: &Path) -> Result<Vec<ImportWarning>, AppError> {
    let mut archive = SafeArchive::open(path, &ArchiveLimits::default())?;
    if archive.entry_names_ordered().first().map(String::as_str) != Some("mimetype") {
        return Err(AppError::new(
            "export_invalid",
            "The exported book is missing its EPUB declaration.",
        ));
    }
    let mimetype = archive.read_entry("mimetype")?;
    if String::from_utf8_lossy(&mimetype).trim() != MIMETYPE {
        return Err(AppError::new(
            "export_invalid",
            "The exported book has an invalid EPUB declaration.",
        ));
    }

    let opf_path = container::find_opf_path(&mut archive)?;
    let opf_bytes = archive.read_entry(&opf_path)?;
    let parsed = opf::parse_opf(&opf_bytes, &opf_path)?;

    let mut documents = HashMap::new();
    for item in parsed.manifest.values() {
        if item.href.contains(":") {
            continue;
        }
        if !archive.contains(&item.href) {
            return Err(AppError::new(
                "export_invalid",
                format!(
                    "A resource listed in the exported book is missing: {} (manifest item {}).",
                    item.href, item.id
                ),
            ));
        }
        if item.media_type == "application/xhtml+xml" {
            let bytes = archive.read_entry(&item.href)?;
            let text = String::from_utf8(bytes).map_err(|_| {
                AppError::new("export_invalid", "An exported document is not UTF-8.")
            })?;
            crate::epub::xml::parse(&text).map_err(|_| {
                AppError::new(
                    "export_invalid",
                    "An exported chapter or navigation document is not well-formed XML.",
                )
            })?;
            documents.insert(item.href.clone(), text);
        }
    }
    let mut warnings = Vec::new();
    for (path, text) in &documents {
        let doc = crate::epub::xml::parse(text)
            .map_err(|_| AppError::new("export_invalid", "Invalid exported document."))?;
        for node in doc.descendants().filter(|node| node.is_element()) {
            for attribute in node
                .attributes()
                .filter(|attr| matches!(attr.name(), "href" | "src"))
            {
                let href = attribute.value();
                // External URLs and data URLs are not archive resources.
                if href.contains(':') || href.starts_with("//") {
                    continue;
                }
                let resource = if href.starts_with('#') || href.starts_with('?') || href.is_empty()
                {
                    path.clone()
                } else {
                    crate::epub::resolve_href(path, href)
                };
                if !archive.contains(&resource) {
                    if node.tag_name().name() == "script" && attribute.name() == "src" {
                        warnings.push(ImportWarning {
                            code: "missing_optional_script".into(),
                            message: format!(
                                "An optional script reference \"{}\" in \"{}\" points to missing resource \"{}\". The book can still be exported; script-based enhancements may be unavailable.",
                                href, path, resource
                            ),
                            location: Some(path.clone()),
                        });
                        continue;
                    }
                    return Err(AppError::new(
                        "export_broken_reference",
                        format!(
                            "The reference \"{}\" in \"{}\" points to missing resource \"{}\". Include original chapters or update this link or image before exporting.",
                            href, path, resource
                        ),
                    ));
                }
                if let Some((_, fragment)) = href.split_once('#') {
                    if !fragment.is_empty()
                        && let Some(target) = documents.get(&resource)
                    {
                        let target = crate::epub::xml::parse(target)
                            .map_err(|_| AppError::new("export_invalid", "Invalid link target."))?;
                        let id = crate::epub::percent_decode_path(fragment);
                        if !target
                            .descendants()
                            .any(|node| node.attribute("id") == Some(id.as_str()))
                        {
                            return Err(AppError::new(
                                "export_broken_reference",
                                "A link points to a missing location in a chapter. Update the translation link before exporting.",
                            ));
                        }
                    }
                }
            }
        }
    }
    Ok(warnings)
}

/// Patches one chapter resource with its translated blocks. Returns the
/// patched bytes (or the original on skip), plus warnings.
fn patched_chapter(
    snapshot: &mut SafeArchive,
    resource_href: &str,
    blocks: &[BlockForExport],
) -> Result<(Vec<u8>, Vec<ImportWarning>), AppError> {
    let original = snapshot.read_entry(resource_href)?;
    if let Some(document) = blocks
        .iter()
        .find(|block| block.structural_locator == "__chapter_document__")
    {
        return match &document.target_fragment {
            Some(html) => Ok((replace_chapter_body(&original, html)?, Vec::new())),
            None => Ok((original, Vec::new())),
        };
    }
    let patches: Vec<patch::BlockPatch> = blocks
        .iter()
        .filter(|block| block.target_fragment.is_some())
        .map(|block| patch::BlockPatch {
            structural_locator: block.structural_locator.clone(),
            element_name: block.element_name.clone(),
            inner_fragment: block.target_fragment.clone().expect("filtered"),
        })
        .collect();
    if patches.is_empty() {
        return Ok((original, Vec::new()));
    }
    match patch::apply_block_patches(&original, &patches) {
        Ok(patched) => {
            // The spliced document must still parse; otherwise keep the
            // original rather than export a corrupt chapter.
            let text = String::from_utf8_lossy(&patched);
            if crate::epub::xml::parse(text.as_ref()).is_err() {
                return Ok((
                    original,
                    vec![ImportWarning {
                        code: "chapter_patch_failed".into(),
                        message: "A translated chapter could not be merged \
                                  safely and keeps its original text."
                            .into(),
                        location: Some(
                            resource_href
                                .rsplit('/')
                                .next()
                                .unwrap_or(resource_href)
                                .to_string(),
                        ),
                    }],
                ));
            }
            Ok((patched, Vec::new()))
        }
        Err(_) => Ok((
            original,
            vec![ImportWarning {
                code: "chapter_patch_failed".into(),
                message: "A translated chapter could not be merged safely and \
                          keeps its original text."
                    .into(),
                location: Some(
                    resource_href
                        .rsplit('/')
                        .next()
                        .unwrap_or(resource_href)
                        .to_string(),
                ),
            }],
        )),
    }
}

fn bilingualize_chapter(
    source: &[u8],
    translated: &[u8],
    source_language: &str,
    target_language: &str,
    alignments: &[crate::domain::BilingualAlignment],
) -> Result<Vec<u8>, AppError> {
    const BLOCKS: &[&str] = &[
        "p",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "li",
        "dt",
        "dd",
        "figcaption",
        "td",
        "th",
        "caption",
    ];
    let invalid = || {
        AppError::new(
            "export_failed",
            "The bilingual chapter could not be paired safely.",
        )
    };
    let source_text = std::str::from_utf8(source).map_err(|_| invalid())?;
    let translated_text = std::str::from_utf8(translated).map_err(|_| invalid())?;
    let source_doc = crate::epub::xml::parse(source_text).map_err(|_| invalid())?;
    let translated_doc = crate::epub::xml::parse(translated_text).map_err(|_| invalid())?;
    fn collect<'a, 'input>(
        doc: &'a roxmltree::Document<'input>,
    ) -> Vec<roxmltree::Node<'a, 'input>> {
        doc.descendants()
            .filter(|node| {
                node.is_element()
                    && BLOCKS.contains(&node.tag_name().name())
                    && !node.descendants().skip(1).any(|child| {
                        child.is_element() && BLOCKS.contains(&child.tag_name().name())
                    })
            })
            .collect::<Vec<_>>()
    }
    let original_blocks = collect(&source_doc);
    let translated_blocks = collect(&translated_doc);
    if original_blocks.len() != translated_blocks.len()
        || original_blocks
            .iter()
            .zip(&translated_blocks)
            .any(|(a, b)| a.tag_name().name() != b.tag_name().name())
    {
        return Err(invalid());
    }
    let inner_range = |text: &str,
                       node: roxmltree::Node<'_, '_>|
     -> Result<std::ops::Range<usize>, AppError> {
        let range = node.range();
        let mut reader = quick_xml::Reader::from_str(&text[range.clone()]);
        let start = match reader.read_event().map_err(|_| invalid())? {
            quick_xml::events::Event::Start(_) => range.start + reader.buffer_position() as usize,
            quick_xml::events::Event::Empty(_) => return Ok(range.end..range.end),
            _ => return Err(invalid()),
        };
        let end = range.start + text[range.clone()].rfind('<').ok_or_else(invalid)?;
        if start > end {
            return Err(invalid());
        }
        Ok(start..end)
    };
    let mut edits = Vec::new();
    for (original, target) in original_blocks.iter().zip(&translated_blocks) {
        let original_inner = inner_range(source_text, *original)?;
        let target_inner = inner_range(translated_text, *target)?;
        let original_html =
            colorize_alignment_spans(&source_text[original_inner], alignments, true);
        let target_html =
            colorize_alignment_spans(&translated_text[target_inner], alignments, false);
        let replacement = format!(
            "<span lang=\"{}\" class=\"sagar-bilingual-original\">{}</span><br/><span lang=\"{}\" class=\"sagar-bilingual-translation\">{}</span>",
            escape_xml_attr(source_language),
            original_html,
            escape_xml_attr(target_language),
            target_html
        );
        let range = inner_range(source_text, *original)?;
        edits.push((range, replacement));
    }
    let mut output = source_text.to_owned();
    edits.sort_by_key(|(range, _)| std::cmp::Reverse(range.start));
    for (range, replacement) in edits {
        output.replace_range(range, &replacement);
    }
    Ok(output.into_bytes())
}

fn colorize_alignment_spans(
    fragment: &str,
    alignments: &[crate::domain::BilingualAlignment],
    source_side: bool,
) -> String {
    const COLORS: [&str; 6] = [
        "#f2c94c", "#56ccf2", "#6fcf97", "#bb6bd9", "#f2994a", "#eb5757",
    ];
    let prefix = "<sagar-root xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" xmlns:svg=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">";
    let wrapped = format!("{prefix}{fragment}</sagar-root>");
    let Ok(doc) = crate::epub::xml::parse(&wrapped) else {
        return fragment.to_string();
    };
    let wrapper_prefix = prefix.len();
    let text_ranges = doc
        .descendants()
        .filter(|node| node.is_text())
        .map(|node| {
            let range = node.range();
            (range.start - wrapper_prefix)..(range.end - wrapper_prefix)
        })
        .collect::<Vec<_>>();
    let mut edits = Vec::new();
    for (color_index, alignment) in alignments.iter().enumerate().take(3000) {
        let phrase = if source_side {
            &alignment.source_text
        } else {
            &alignment.target_text
        };
        if phrase.trim().is_empty() || phrase.chars().count() > 120 {
            continue;
        }
        let escaped_phrase = escape_xml_text(phrase);
        let title = format!(
            "{} = {} — {}; {}",
            alignment.source_text, alignment.target_text, alignment.meaning, alignment.grammar_note
        );
        let style = format!(
            "background-color:{};color:inherit;border-radius:.15em;padding:0 .08em",
            COLORS[color_index % COLORS.len()]
        );
        let open = format!(
            "<span style=\"{}\" title=\"{}\">",
            escape_xml_attr(&style),
            escape_xml_attr(&title)
        );
        for range in &text_ranges {
            let Some(raw_text) = fragment.get(range.clone()) else {
                continue;
            };
            let mut offset = 0;
            while let Some(relative) = raw_text[offset..].find(&escaped_phrase) {
                let start = range.start + offset + relative;
                let end = start + escaped_phrase.len();
                let replacement = format!("{open}{escaped_phrase}</span>");
                edits.push((start..end, replacement));
                offset += relative + escaped_phrase.len();
                if offset >= raw_text.len() {
                    break;
                }
            }
        }
    }
    let mut output = fragment.to_string();
    edits.sort_by_key(|(range, _)| std::cmp::Reverse(range.start));
    let mut last_start = usize::MAX;
    for (range, replacement) in edits {
        if range.end > last_start {
            continue;
        }
        output.replace_range(range.clone(), &replacement);
        last_start = range.start;
    }
    output
}

fn escape_xml_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn escape_xml_attr(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Export use case: everything except destination finalization.
/// Loads per-block export rows for a chapter id.
pub type BlocksLoader = Box<dyn Fn(&str) -> Result<Vec<BlockForExport>, AppError> + Send>;

pub struct ExportInput {
    pub snapshot_path: std::path::PathBuf,
    pub destination: std::path::PathBuf,
    pub translated_title: Option<String>,
    pub metadata: Vec<(String, String)>,
    pub custom_cover: Option<String>,
    pub target_language: String,
    pub source_language: Option<String>,
    pub bilingual: bool,
    /// Per-chapter cached word and phrase alignments for bilingual styling.
    pub bilingual_alignments:
        std::collections::HashMap<String, Vec<crate::domain::BilingualAlignment>>,
    /// (chapter_id, resource_href) in spine order with per-block patches.
    pub chapters: Vec<(String, String)>,
    /// Load blocks per chapter from storage.
    pub load_blocks: BlocksLoader,
    /// When false, draft chapters without any saved translation are omitted
    /// from the output book instead of falling back to original content.
    /// Defaults to true (preserve current draft behavior) when unset.
    pub include_original: bool,
}

pub fn run_export(input: ExportInput) -> Result<ExportOutcome, AppError> {
    let mut snapshot = SafeArchive::open(&input.snapshot_path, &ArchiveLimits::default())?;

    let opf_path = container::find_opf_path(&mut snapshot)?;
    let opf_bytes = snapshot.read_entry(&opf_path)?;
    let parsed_opf = opf::parse_opf(&opf_bytes, &opf_path)?;

    let _opf_dir = match opf_path.rfind('/') {
        Some(index) => opf_path[..index].to_string(),
        None => String::new(),
    };
    // parse_opf already resolves the nav href to a ZIP-root path.
    let nav_path = parsed_opf.nav_href.clone();

    let mut patched: HashMap<String, Vec<u8>> = HashMap::new();
    let mut warnings = Vec::new();
    let mut blocks_translated = 0usize;
    let mut nav_labels: HashMap<String, String> = HashMap::new();
    let mut added_images: HashMap<String, (String, Vec<u8>)> = HashMap::new();
    let mut excluded: HashSet<String> = HashSet::new();
    let mut included_count = 0usize;

    for (chapter_id, resource_href) in &input.chapters {
        let mut blocks = (input.load_blocks)(chapter_id)?;
        let has_translation = blocks.iter().any(|b| b.target_fragment.is_some());
        if !input.include_original && !has_translation {
            excluded.insert(resource_href.clone());
            continue;
        }
        included_count += 1;
        for block in &mut blocks {
            if let Some(fragment) = &block.target_fragment {
                block.target_fragment = Some(package_images(
                    fragment,
                    resource_href,
                    &opf_path,
                    &snapshot,
                    &mut added_images,
                )?);
            }
        }
        let heading_label = blocks.iter().find_map(|block| {
            let fragment = block.target_fragment.as_ref()?;
            if matches!(
                block.element_name.as_str(),
                "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
            ) {
                return Some(crate::domain::strip_fragment(fragment));
            }
            if block.structural_locator == "__chapter_document__" {
                let wrapped = format!("<w>{fragment}</w>");
                let doc = crate::epub::xml::parse(&wrapped).ok()?;
                let heading = doc.descendants().find(|node| {
                    node.is_element()
                        && matches!(
                            node.tag_name().name(),
                            "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
                        )
                })?;
                return Some(
                    heading
                        .descendants()
                        .filter_map(|node| node.text().filter(|_| node.is_text()))
                        .collect::<String>(),
                );
            }
            None
        });
        if let Some(label) = heading_label {
            nav_labels.insert(resource_href.clone(), label);
        }

        let translated_count = blocks
            .iter()
            .filter(|block| block.target_fragment.is_some())
            .count();
        blocks_translated += translated_count;
        let (mut bytes, chapter_warnings) = patched_chapter(&mut snapshot, resource_href, &blocks)?;
        if input.bilingual && has_translation && chapter_warnings.is_empty() {
            let source = snapshot.read_entry(resource_href)?;
            bytes = bilingualize_chapter(
                &source,
                &bytes,
                input.source_language.as_deref().unwrap_or("en"),
                &input.target_language,
                input
                    .bilingual_alignments
                    .get(chapter_id)
                    .map(Vec::as_slice)
                    .unwrap_or_default(),
            )?;
        }
        warnings.extend(chapter_warnings);
        patched.insert(resource_href.clone(), bytes);
    }

    if !excluded.is_empty() && included_count == 0 {
        return Err(AppError::new(
            "nothing_to_export",
            "No translated chapters to export. Translate at least one chapter \
             or enable original content for untranslated chapters.",
        ));
    }

    // Drop a legacy NCX (EPUB 2 fallback) when filtering, since EPUB 3
    // readers use the nav document. Keeping NCX entries that point at
    // omitted files would leave dangling references.
    let mut ncx_dropped: Option<String> = None;
    if !excluded.is_empty() {
        let ncx_href = parsed_opf
            .manifest
            .values()
            .find(|item| item.media_type == "application/x-dtbncx+xml")
            .map(|item| item.href.clone());
        if let Some(href) = ncx_href {
            ncx_dropped = Some(href.clone());
            excluded.insert(href);
        }
    }

    if let Some(nav_path) = &nav_path {
        let bytes = patched
            .remove(nav_path)
            .map(Ok)
            .unwrap_or_else(|| snapshot.read_entry(nav_path))?;
        let mut nav_out = bytes;
        if !excluded.is_empty() {
            nav_out = strip_nav_entries(&nav_out, nav_path, &excluded);
        }
        if !nav_labels.is_empty() {
            nav_out = patch::patch_anchor_labels(&nav_out, &nav_labels, nav_path);
        }
        patched.insert(nav_path.clone(), nav_out);
    }

    // Package metadata: title and language.
    let opf_source = patched
        .remove(&opf_path)
        .map(Ok)
        .unwrap_or_else(|| snapshot.read_entry(&opf_path))?;
    let mut opf_out = opf_source;
    if let Some(title) = &input.translated_title {
        opf_out = patch::upsert_dc_metadata(&opf_out, "title", title)?;
    }
    opf_out = patch::upsert_dc_metadata(&opf_out, "language", &input.target_language)?;
    for (name, value) in &input.metadata {
        opf_out = patch::upsert_dc_metadata(&opf_out, name, value)?;
    }
    if !excluded.is_empty() {
        let excluded_ids = opf_ids_for_hrefs(&parsed_opf, &excluded);
        opf_out = strip_opf_entries(&opf_out, &excluded_ids)?;
        warnings.push(ImportWarning {
            code: "excluded_untranslated".into(),
            message: format!(
                "{} untranslated chapter{} omitted (translated-only draft).",
                excluded.len() - usize::from(ncx_dropped.is_some()),
                if excluded.len() - usize::from(ncx_dropped.is_some()) == 1 {
                    ""
                } else {
                    "s"
                },
            ),
            location: None,
        });
        if ncx_dropped.is_some() {
            warnings.push(ImportWarning {
                code: "ncx_removed_for_filtered_export".into(),
                message: "The legacy table of contents (NCX) was removed for this \
                          translated-only draft; the EPUB 3 navigation is kept."
                    .into(),
                location: None,
            });
        }
    }
    if !added_images.is_empty() {
        let text = std::str::from_utf8(&opf_out)
            .map_err(|_| AppError::new("export_failed", "Invalid package encoding."))?;
        let doc = crate::epub::xml::parse(text)
            .map_err(|_| AppError::new("export_failed", "Invalid package document."))?;
        let manifest = doc
            .descendants()
            .find(|n| n.has_tag_name(("http://www.idpf.org/2007/opf", "manifest")))
            .ok_or_else(|| AppError::new("export_failed", "Missing manifest."))?;
        let range = manifest.range();
        let closing = text[range.clone()]
            .rfind('<')
            .ok_or_else(|| AppError::new("export_failed", "Invalid manifest."))?
            + range.start;
        let mut items = String::new();
        for (path, (mime, _)) in &added_images {
            items.push_str(&format!("<item xmlns=\"http://www.idpf.org/2007/opf\" id=\"sagar-{}\" href=\"{}\" media-type=\"{}\"/>", uuid::Uuid::new_v4(), relative_resource(&opf_path, path), mime));
        }
        opf_out.splice(closing..closing, items.bytes());
    }
    for (path, (_, bytes)) in added_images {
        patched.insert(path, bytes);
    }
    if let Some(cover) = &input.custom_cover {
        opf_out = super::cover::apply(
            &mut snapshot,
            &parsed_opf,
            &opf_path,
            &opf_out,
            &mut patched,
            &excluded,
            cover,
        )?;
    }
    let text = String::from_utf8_lossy(&opf_out);
    if crate::epub::xml::parse(text.as_ref()).is_err() {
        return Err(AppError::new(
            "export_failed",
            "The package document could not be updated safely.",
        ));
    }
    patched.insert(opf_path.clone(), opf_out);

    write_archive(
        &input.snapshot_path,
        &patched,
        &excluded,
        &input.destination,
    )?;

    let validation_warnings = validate_output(&input.destination)?;
    warnings.extend(validation_warnings);

    Ok(ExportOutcome {
        output_path: input.destination.to_string_lossy().to_string(),
        mode: String::new(),
        chapters_exported: included_count,
        blocks_translated,
        warnings,
    })
}

/// Maps excluded ZIP-root resource hrefs to their OPF manifest ids.
fn opf_ids_for_hrefs(parsed: &opf::ParsedOpf, excluded: &HashSet<String>) -> HashSet<String> {
    parsed
        .manifest
        .values()
        .filter(|item| excluded.contains(&item.href))
        .map(|item| item.id.clone())
        .collect()
}

/// Removes `<item>` / `<itemref>` elements for excluded manifest ids via
/// byte-span splicing, preserving everything else byte-for-byte.
fn strip_opf_entries(bytes: &[u8], excluded_ids: &HashSet<String>) -> Result<Vec<u8>, AppError> {
    if excluded_ids.is_empty() {
        return Ok(bytes.to_vec());
    }
    use quick_xml::events::Event;
    let mut reader = quick_xml::Reader::from_reader(bytes);
    let mut buffer = Vec::new();
    let mut spans: Vec<(usize, usize)> = Vec::new();
    let mut depth: usize = 0;
    let mut pending: Option<(usize, usize, String)> = None;
    loop {
        let pos_before = reader.buffer_position() as usize;
        let event = match reader.read_event_into(&mut buffer) {
            Ok(e) => e,
            Err(_) => {
                return Err(AppError::new(
                    "export_failed",
                    "The package document could not be updated safely.",
                ));
            }
        };
        let pos_after = reader.buffer_position() as usize;
        match event {
            Event::Start(ref start) => {
                let local: String = start.local_name().as_ref().to_ascii_lowercase();
                let is_target = local == "item" || local == "itemref";
                let excluded_match = if is_target && pending.is_none() {
                    let attr_name = if local == "item" { "id" } else { "idref" };
                    start
                        .try_get_attribute(attr_name)
                        .ok()
                        .flatten()
                        .map(|a| a.value.as_ref().to_owned())
                        .map(|v| excluded_ids.contains(&v))
                        .unwrap_or(false)
                } else {
                    false
                };
                if excluded_match {
                    pending = Some((pos_before, depth, local));
                }
                depth += 1;
            }
            Event::Empty(ref empty) => {
                let local: String = empty.local_name().as_ref().to_ascii_lowercase();
                if (local == "item" || local == "itemref") && pending.is_none() {
                    let attr_name = if local == "item" { "id" } else { "idref" };
                    let is_excluded = empty
                        .try_get_attribute(attr_name)
                        .ok()
                        .flatten()
                        .map(|a| a.value.as_ref().to_owned())
                        .map(|v| excluded_ids.contains(&v))
                        .unwrap_or(false);
                    if is_excluded {
                        spans.push((pos_before, pos_after));
                    }
                }
            }
            Event::End(ref end) => {
                depth = depth.saturating_sub(1);
                if let Some((start_pos, start_depth, ref tag)) = pending {
                    let end_local: String = end.local_name().as_ref().to_ascii_lowercase();
                    if depth == start_depth && end_local == *tag {
                        spans.push((start_pos, pos_after));
                        pending = None;
                    }
                }
            }
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }
    // A dangling start without an end means malformed OPF; fail loudly
    // rather than exporting a corrupt package.
    if pending.is_some() {
        return Err(AppError::new(
            "export_failed",
            "The package document could not be updated safely.",
        ));
    }
    let mut out = bytes.to_vec();
    spans.sort_by_key(|&(s, _)| std::cmp::Reverse(s));
    for (start, end) in spans {
        if end > start && end <= out.len() {
            out.splice(start..end, []);
        }
    }
    Ok(out)
}

struct NavLiFrame {
    start: usize,
    direct_excluded: Option<bool>,
    has_included: bool,
}

fn nav_href_is_excluded(href: &str, nav_path: &str, excluded: &HashSet<String>) -> bool {
    let resolved = crate::epub::resolve_href(nav_path, href);
    excluded.contains(&resolved)
}

fn decode_href_entities(value: &str) -> String {
    let text = value.to_string();
    text.replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

/// Removes `<li>` table-of-contents entries whose anchors all resolve to
/// excluded chapter resources. Entries with mixed included/excluded
/// descendants are kept so translated nested sections are never dropped.
fn strip_nav_entries(bytes: &[u8], nav_path: &str, excluded: &HashSet<String>) -> Vec<u8> {
    if excluded.is_empty() {
        return bytes.to_vec();
    }
    use quick_xml::events::Event;
    let mut reader = quick_xml::Reader::from_reader(bytes);
    let mut buffer = Vec::new();
    let mut stack: Vec<NavLiFrame> = Vec::new();
    let mut spans: Vec<(usize, usize)> = Vec::new();
    loop {
        let pos_before = reader.buffer_position() as usize;
        let event = match reader.read_event_into(&mut buffer) {
            Ok(e) => e,
            Err(_) => return bytes.to_vec(),
        };
        let pos_after = reader.buffer_position() as usize;
        match event {
            Event::Start(ref start) => {
                let local: String = start.local_name().as_ref().to_ascii_lowercase();
                if local == "li" {
                    stack.push(NavLiFrame {
                        start: pos_before,
                        direct_excluded: None,
                        has_included: false,
                    });
                } else if local == "a"
                    && let Some(href) = start
                        .try_get_attribute("href")
                        .ok()
                        .flatten()
                        .map(|a| decode_href_entities(a.value.as_ref()))
                {
                    let is_excluded = nav_href_is_excluded(&href, nav_path, excluded);
                    if let Some(frame) = stack.last_mut() {
                        if frame.direct_excluded.is_none() {
                            frame.direct_excluded = Some(is_excluded);
                        }
                        if !is_excluded {
                            for open in stack.iter_mut() {
                                open.has_included = true;
                            }
                        }
                    }
                }
            }
            Event::Empty(ref empty) => {
                let local: String = empty.local_name().as_ref().to_ascii_lowercase();
                if local == "a"
                    && let Some(href) = empty
                        .try_get_attribute("href")
                        .ok()
                        .flatten()
                        .map(|a| decode_href_entities(a.value.as_ref()))
                {
                    let is_excluded = nav_href_is_excluded(&href, nav_path, excluded);
                    if let Some(frame) = stack.last_mut() {
                        if frame.direct_excluded.is_none() {
                            frame.direct_excluded = Some(is_excluded);
                        }
                        if !is_excluded {
                            for open in stack.iter_mut() {
                                open.has_included = true;
                            }
                        }
                    }
                }
            }
            Event::End(ref end) => {
                let local: String = end.local_name().as_ref().to_ascii_lowercase();
                if local == "li"
                    && let Some(frame) = stack.pop()
                    && frame.direct_excluded == Some(true)
                    && !frame.has_included
                {
                    spans.push((frame.start, pos_after));
                }
            }
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }
    let mut out = bytes.to_vec();
    spans.sort_by_key(|&(s, _)| std::cmp::Reverse(s));
    for (start, end) in spans {
        if end > start && end <= out.len() {
            out.splice(start..end, []);
        }
    }
    out
}

pub(super) fn relative_resource(base: &str, target: &str) -> String {
    let mut base_parts: Vec<&str> = base.split('/').collect();
    base_parts.pop();
    let target_parts: Vec<&str> = target.split('/').collect();
    let common = base_parts
        .iter()
        .zip(&target_parts)
        .take_while(|(a, b)| a == b)
        .count();
    let mut result = vec![".."; base_parts.len() - common];
    result.extend_from_slice(&target_parts[common..]);
    result.join("/")
}

fn package_images(
    fragment: &str,
    chapter: &str,
    opf: &str,
    snapshot: &SafeArchive,
    images: &mut HashMap<String, (String, Vec<u8>)>,
) -> Result<String, AppError> {
    let wrapped = format!("<w>{fragment}</w>");
    let doc = crate::epub::xml::parse(&wrapped)
        .map_err(|_| AppError::new("invalid_translation", "Invalid saved XHTML."))?;
    let mut result = fragment.to_string();
    // New <img> uploads (data: URLs) plus SVG cover images that carry a
    // pasted data: URL in either href form are packaged as new resources.
    // Relative original references (e.g. "cover.jpg") stay untouched so the
    // immutable snapshot resource is reused byte-for-byte at export.
    let targets: Vec<String> = doc
        .descendants()
        .filter(|n| n.is_element())
        .filter_map(|n| {
            // Match by local name: stored fragments are wrapped without a
            // default namespace, so namespaced matching would miss them.
            if n.tag_name().name() == "img" {
                n.attribute("src").map(str::to_string)
            } else if n.tag_name().name() == "image" {
                n.attribute("href")
                    .or_else(|| {
                        n.attributes()
                            .find(|a| {
                                a.name() == "href"
                                    && a.namespace() == Some("http://www.w3.org/1999/xlink")
                            })
                            .map(|a| a.value())
                    })
                    .map(str::to_string)
            } else {
                None
            }
        })
        .collect();
    for src in targets {
        if !src.starts_with("data:") {
            continue;
        }
        let (mime, bytes) = super::rich_text::image_bytes(&src)?;
        use sha2::{Digest, Sha256};
        let digest: String = Sha256::digest(&bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        let extension = match mime {
            "image/png" => "png",
            "image/jpeg" => "jpg",
            "image/webp" => "webp",
            "image/avif" => "avif",
            "image/bmp" => "bmp",
            _ => "gif",
        };
        let opf_dir = opf
            .rsplit_once('/')
            .map(|(dir, _)| format!("{dir}/"))
            .unwrap_or_default();
        let path = format!("{opf_dir}sagar-images/{digest}.{extension}");
        if snapshot.contains(&path) {
            return Err(AppError::new(
                "export_failed",
                "An added image conflicts with a source resource.",
            ));
        }
        images
            .entry(path.clone())
            .or_insert((mime.to_string(), bytes));
        result = result.replace(src.as_str(), &relative_resource(chapter, &path));
    }
    Ok(result)
}

/// Reads the raw inner HTML of a chapter's `<body>` (between the body's own
/// start tag and its closing tag). Used as translation source material so the
/// original structure — tables, images, attributes — travels with the text.
pub(crate) fn chapter_body_inner(original: &[u8]) -> Result<String, AppError> {
    let invalid = || {
        AppError::new(
            "export_failed",
            "The chapter body could not be read safely.",
        )
    };
    let source = std::str::from_utf8(original).map_err(|_| invalid())?;
    let doc = crate::epub::xml::parse(source).map_err(|_| invalid())?;
    let body = doc
        .descendants()
        .find(|n| n.has_tag_name(("http://www.w3.org/1999/xhtml", "body")))
        .ok_or_else(invalid)?;
    let range = body.range();
    let mut reader = quick_xml::Reader::from_reader(&original[range.clone()]);
    let mut buffer = Vec::new();
    let start = loop {
        match reader.read_event_into(&mut buffer).map_err(|_| invalid())? {
            quick_xml::events::Event::Start(_) => {
                break range.start + reader.buffer_position() as usize;
            }
            quick_xml::events::Event::Empty(_) => return Ok(String::new()),
            quick_xml::events::Event::Eof => return Err(invalid()),
            _ => buffer.clear(),
        }
    };
    let end = range.start + source[range.clone()].rfind('<').ok_or_else(invalid)?;
    if end < start {
        return Err(invalid());
    }
    Ok(source[start..end].to_string())
}

/// Read-only document context for HTML authoring; original bytes are retained.
pub(crate) fn chapter_document_shell(original: &[u8]) -> Result<(String, String), AppError> {
    let invalid = || {
        AppError::new(
            "invalid_epub",
            "The chapter document wrapper could not be read.",
        )
    };
    let source = std::str::from_utf8(original).map_err(|_| invalid())?;
    let doc = crate::epub::xml::parse(source).map_err(|_| invalid())?;
    let body = doc
        .descendants()
        .find(|n| n.has_tag_name(("http://www.w3.org/1999/xhtml", "body")))
        .ok_or_else(invalid)?;
    let range = body.range();
    let mut reader = quick_xml::Reader::from_str(&source[range.clone()]);
    match reader.read_event().map_err(|_| invalid())? {
        quick_xml::events::Event::Start(_) => {
            let start = range.start + reader.buffer_position() as usize;
            let end = range.start + source[range.clone()].rfind('<').ok_or_else(invalid)?;
            Ok((source[..start].to_owned(), source[end..].to_owned()))
        }
        quick_xml::events::Event::Empty(element) => {
            let name = element.name().as_ref().to_owned();
            Ok((
                format!("{}>", &source[..range.end - 2]),
                format!("</{name}>{}", &source[range.end..]),
            ))
        }
        _ => Err(invalid()),
    }
}

/// Replace the authored chapter body, preserving its outer attributes, head,
/// source resources and old anchor IDs so existing navigation remains resolvable.
fn replace_chapter_body(original: &[u8], html: &str) -> Result<Vec<u8>, AppError> {
    let invalid = || {
        AppError::new(
            "export_failed",
            "The chapter body could not be replaced safely.",
        )
    };
    let source = std::str::from_utf8(original).map_err(|_| invalid())?;
    let doc = crate::epub::xml::parse(source).map_err(|_| invalid())?;
    let body = doc
        .descendants()
        .find(|n| n.has_tag_name(("http://www.w3.org/1999/xhtml", "body")))
        .ok_or_else(invalid)?;
    let range = body.range();
    let mut reader = quick_xml::Reader::from_reader(&original[range.clone()]);
    let mut buffer = Vec::new();
    let start = match reader.read_event_into(&mut buffer).map_err(|_| invalid())? {
        quick_xml::events::Event::Start(_) => range.start + reader.buffer_position() as usize,
        quick_xml::events::Event::Empty(_) => {
            let raw = &source[range.clone()];
            let name = raw
                .trim_start_matches('<')
                .split(|c: char| c.is_whitespace() || c == '/')
                .next()
                .ok_or_else(invalid)?;
            let content = format!("<div xmlns=\"http://www.w3.org/1999/xhtml\">{html}</div>");
            let replacement = format!("{}>{content}</{name}>", &raw[..raw.len() - 2]);
            let mut out = original.to_vec();
            out.splice(range, replacement.bytes());
            return Ok(out);
        }
        _ => return Err(invalid()),
    };
    let end = range.start + source[range.clone()].rfind('<').ok_or_else(invalid)?;
    let wrapped = format!("<w>{html}</w>");
    let target = crate::epub::xml::parse(&wrapped).map_err(|_| invalid())?;
    let mut anchors = String::new();
    for node in body.descendants().skip(1).filter(|n| n.is_element()) {
        if let Some(id) = node.attribute("id") {
            if !target.descendants().any(|n| n.attribute("id") == Some(id)) {
                anchors.push_str(&format!(
                    "<span id=\"{}\"></span>",
                    super::preview::escape_html_text(id)
                ));
            }
        }
    }
    let content = format!("{anchors}{html}");
    let replacement = if body.lookup_namespace_uri(None) == Some("http://www.w3.org/1999/xhtml") {
        content
    } else {
        format!("<div xmlns=\"http://www.w3.org/1999/xhtml\">{content}</div>")
    };
    let mut out = original.to_vec();
    out.splice(start..end, replacement.bytes());
    crate::epub::xml::parse(std::str::from_utf8(&out).map_err(|_| invalid())?)
        .map_err(|_| invalid())?;
    Ok(out)
}

#[cfg(test)]
mod chapter_document_tests {
    use super::*;
    #[test]
    fn translated_body_preserves_document_head_stylesheets_and_body_class() {
        let source = r#"<?xml version='1.0' encoding='utf-8'?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="" xml:lang="">
  <head>
    <title>Synthetic book</title>
    <meta name="generator" content="fixture"/>
    <link rel="stylesheet" type="text/css" href="stylesheet.css"/>
    <link rel="stylesheet" type="text/css" href="page_styles.css"/>
  </head>
  <body class="calibre"><p class="calibre1">Original</p></body>
</html>"#;
        let translated = "<p class=\"calibre1\">မင်္ဂလာပါ</p>";
        let output = replace_chapter_body(source.as_bytes(), translated).expect("replace");
        let expected = source.replace("<p class=\"calibre1\">Original</p>", translated);
        assert_eq!(output, expected.as_bytes());
        let (prefix, suffix) = chapter_document_shell(source.as_bytes()).expect("shell");
        assert_eq!(format!("{prefix}{translated}{suffix}"), expected);
    }

    #[test]
    fn replaces_prefixed_and_empty_bodies_without_losing_attributes() {
        for source in [
            r#"<x:html xmlns:x="http://www.w3.org/1999/xhtml"><x:head><x:title>T</x:title></x:head><x:body id="chapter"><x:p id="anchor">Original</x:p></x:body></x:html>"#,
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>T</title></head><body id="chapter"/></html>"#,
        ] {
            let (prefix, suffix) = chapter_document_shell(source.as_bytes()).expect("shell");
            let displayed = format!("{prefix}<p>မြန်မာ</p>{suffix}");
            let displayed_doc = crate::epub::xml::parse(&displayed).expect("display xml");
            assert!(
                displayed_doc
                    .descendants()
                    .any(|node| node.attribute("id") == Some("chapter"))
            );
            let output = replace_chapter_body(source.as_bytes(), "<h2>New</h2><p>Free text</p>")
                .expect("replace");
            let text = std::str::from_utf8(&output).expect("utf8");
            let doc = crate::epub::xml::parse(text).expect("xml");
            assert!(
                doc.descendants()
                    .any(|n| n.has_tag_name(("http://www.w3.org/1999/xhtml", "h2")))
            );
            assert!(
                doc.descendants()
                    .any(|n| n.has_tag_name(("http://www.w3.org/1999/xhtml", "body"))
                        && n.attribute("id") == Some("chapter"))
            );
        }
    }

    #[test]
    fn reads_body_inner_html_verbatim() {
        let source = r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>T</title></head><body id="chapter"><h1>Hi</h1><p>Text <img src="images/a.png" alt="A"/></p><table><tbody><tr><td>Cell</td></tr></tbody></table></body></html>"#;
        let inner = chapter_body_inner(source.as_bytes()).expect("inner");
        assert!(inner.contains("<h1>Hi</h1>"), "{inner}");
        assert!(
            inner.contains("<img src=\"images/a.png\" alt=\"A\"/>"),
            "{inner}"
        );
        assert!(inner.contains("<table>"), "{inner}");
        assert!(!inner.contains("<body"), "{inner}");

        let empty = r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>T</title></head><body id="chapter"/></html>"#;
        assert_eq!(chapter_body_inner(empty.as_bytes()).expect("empty"), "");
    }

    #[test]
    fn bilingual_export_pairs_source_and_translation_inside_original_blocks() {
        let source = r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><h1 id="title">Chapter</h1><p id="p1">Read <i>this</i></p><p id="p2">Next</p></body></html>"#;
        let translated = r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><h1 id="title">အခန်း</h1><p id="p1">ဖတ်ပါ <i>ဤစာ</i></p><p id="p2">နောက်တစ်ခု</p></body></html>"#;
        let output =
            bilingualize_chapter(source.as_bytes(), translated.as_bytes(), "en", "my", &[])
                .expect("bilingualize");
        let output = std::str::from_utf8(&output).expect("utf8");
        assert!(output.contains("lang=\"en\" class=\"sagar-bilingual-original\">Read <i>this</i>"));
        assert!(
            output.contains("lang=\"my\" class=\"sagar-bilingual-translation\">ဖတ်ပါ <i>ဤစာ</i>")
        );
        assert!(output.contains("id=\"p1\""));
        assert_eq!(output.matches("id=\"p1\"").count(), 1);
        crate::epub::xml::parse(output).expect("valid bilingual xhtml");
    }

    #[test]
    fn bilingual_export_colors_matching_words_and_includes_meaning_tooltips() {
        let source = r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p>I am Kyaw Kyaw.</p></body></html>"#;
        let translated = r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p>ကျွန်တော်က ကျော်ကျော်ပါ။</p></body></html>"#;
        let alignments = vec![crate::domain::BilingualAlignment {
            source_text: "I".into(),
            target_text: "ကျွန်တော်".into(),
            meaning: "မိမိကိုယ်ကို ရည်ညွှန်းသောစကား".into(),
            grammar_note: "ပထမပုဂ္ဂိုလ် နာမ်စား".into(),
        }];
        let output = bilingualize_chapter(
            source.as_bytes(),
            translated.as_bytes(),
            "en",
            "my",
            &alignments,
        )
        .expect("colored bilingual chapter");
        let output = std::str::from_utf8(&output).expect("utf8");
        assert_eq!(output.matches("background-color:#f2c94c").count(), 2);
        assert!(output.contains("title=\"I = ကျွန်တော် — မိမိကိုယ်ကို ရည်ညွှန်းသောစကား; ပထမပုဂ္ဂိုလ် နာမ်စား\""));
        crate::epub::xml::parse(output).expect("valid colored bilingual xhtml");
    }

    #[test]
    fn bilingual_export_rejects_unmatched_block_structure() {
        let source = r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Source</p><p>Second</p></body></html>"#;
        let translated =
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p>တစ်ခု</p></body></html>"#;
        assert!(
            bilingualize_chapter(source.as_bytes(), translated.as_bytes(), "en", "my", &[])
                .is_err()
        );
    }
}
