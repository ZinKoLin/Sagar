//! EPUB engine: safe archive access plus OCF/OPF/nav/XHTML parsing for
//! import. Parsing is namespace-aware via `roxmltree`; never use string
//! matching or regular expressions on EPUB structure.

pub mod archive;
pub mod blocks;
pub mod container;
pub mod cover;
pub mod export;
pub mod nav;
pub mod opf;
pub mod patch;
pub mod preview;
pub mod rich_text;
pub(crate) mod xml;

use std::path::Path;

use crate::domain::ImportWarning;
use crate::error::AppError;
use crate::security::ArchiveLimits;

use archive::SafeArchive;
use blocks::ParsedBlock;
use opf::BookMetadata;

/// One spine item with its resolved blocks.
pub struct ParsedChapter {
    pub manifest_item_id: String,
    /// ZIP-root-relative path of the XHTML resource.
    pub resource_href: String,
    pub title: String,
    pub blocks: Vec<ParsedBlock>,
    pub warnings: Vec<ImportWarning>,
}

/// Everything extracted from a validated EPUB before any database rows are
/// created.
pub struct ParsedEpub {
    pub metadata: BookMetadata,
    pub cover_href: Option<String>,
    pub chapters: Vec<ParsedChapter>,
    pub warnings: Vec<ImportWarning>,
}

/// Validates and parses an EPUB file. Chapter order comes from the OPF spine,
/// never from ZIP entry order (invariant: reading order).
pub fn inspect(path: &Path) -> Result<ParsedEpub, AppError> {
    let mut archive = SafeArchive::open(path, &ArchiveLimits::default())?;
    let mut warnings = Vec::new();

    check_mimetype(&mut archive)?;

    let opf_path = container::find_opf_path(&mut archive)?;
    let opf_bytes = archive.read_entry(&opf_path)?;
    let parsed_opf = opf::parse_opf(&opf_bytes, &opf_path)?;
    warnings.extend(parsed_opf.warnings);

    let nav_toc = parsed_opf.nav_href.as_deref().and_then(|href| {
        archive
            .read_entry(href)
            .ok()
            .and_then(|bytes| nav::parse_nav(&bytes, href).ok())
    });
    let ncx_toc = parsed_opf.ncx_href.as_deref().and_then(|href| {
        archive
            .read_entry(href)
            .ok()
            .and_then(|bytes| nav::parse_ncx(&bytes, href).ok())
    });
    let toc = nav_toc.or(ncx_toc).unwrap_or_else(|| {
        let has_navigation_resource = parsed_opf
            .nav_href
            .as_deref()
            .is_some_and(|href| archive.contains(href))
            || parsed_opf
                .ncx_href
                .as_deref()
                .is_some_and(|href| archive.contains(href));
        warnings.push(ImportWarning {
            code: if has_navigation_resource {
                "navigation_unreadable"
            } else {
                "navigation_missing"
            }
            .into(),
            message: "The book's table of contents could not be read; chapter \
                      titles may fall back to headings."
                .into(),
            location: None,
        });
        Vec::new()
    });

    let mut chapters = Vec::new();
    for (position, item) in parsed_opf.spine_items.iter().enumerate() {
        let href = item.href.clone();
        let mut chapter_warnings = Vec::new();
        let mut blocks = Vec::new();
        let mut heading_title = None;

        match archive.read_entry(&href) {
            Ok(bytes) => {
                let parsed_blocks = blocks::parse_chapter(&bytes);
                heading_title = parsed_blocks.first_heading_text;
                blocks = parsed_blocks.blocks;
                chapter_warnings.extend(parsed_blocks.warnings);
            }
            Err(error) => {
                chapter_warnings.push(ImportWarning {
                    code: "chapter_unreadable".into(),
                    message: "A chapter could not be read from the book and was \
                              imported without content."
                        .into(),
                    location: Some(format!("Chapter {}", position + 1)),
                });
                let _ = error;
            }
        }

        let title = resolve_chapter_title(&toc, &href, heading_title, position);
        chapters.push(ParsedChapter {
            manifest_item_id: item.id.clone(),
            resource_href: href,
            title,
            blocks,
            warnings: chapter_warnings,
        });
    }

    if chapters.is_empty() {
        return Err(AppError::new(
            "invalid_epub",
            "The book's reading order (spine) contains no readable chapters.",
        ));
    }

    let cover_declared = parsed_opf.cover_href.clone();
    let cover_href = parsed_opf
        .cover_href
        .as_deref()
        .filter(|href| archive.contains(href))
        .map(str::to_string);
    if cover_declared.is_some() && cover_href.is_none() {
        warnings.push(ImportWarning {
            code: "cover_missing".into(),
            message: "The declared cover image is missing from the book.".into(),
            location: None,
        });
    }

    Ok(ParsedEpub {
        metadata: parsed_opf.metadata,
        cover_href,
        chapters,
        warnings,
    })
}

/// Enforces the OCF `mimetype` declaration. A missing or wrong declaration
/// means the file is not a valid EPUB; a badly placed one is only a warning.
fn check_mimetype(archive: &mut SafeArchive) -> Result<(), AppError> {
    let invalid = || {
        AppError::new(
            "invalid_epub",
            "This file does not declare itself as an EPUB book.",
        )
    };
    if !archive.contains("mimetype") {
        return Err(invalid());
    }
    let content = archive.read_entry("mimetype")?;
    // OCF requires the exact value; tolerate stray trailing whitespace that
    // some authoring tools append.
    let declared = std::str::from_utf8(&content).unwrap_or("").trim();
    if declared != "application/epub+zip" {
        return Err(invalid());
    }
    Ok(())
}

/// Title precedence: table of contents, then the chapter's first heading,
/// then the resource file name.
fn resolve_chapter_title(
    toc: &[nav::NavEntry],
    resource_href: &str,
    heading_title: Option<String>,
    position: usize,
) -> String {
    if let Some(entry) = toc.iter().find(|entry| entry.resource == resource_href) {
        return entry.title.clone();
    }
    if let Some(heading) = heading_title {
        return heading;
    }
    let stem = resource_href
        .rsplit('/')
        .next()
        .unwrap_or(resource_href)
        .split('.')
        .next()
        .unwrap_or("");
    if !stem.is_empty() {
        return stem.to_string();
    }
    format!("Chapter {}", position + 1)
}

/// Resolves `href` relative to the directory of `base_resource` (both
/// '/'-separated ZIP-root paths), dropping URI fragment/query parts,
/// percent-decoding the path, and normalizing `.`/`..` segments.
pub(crate) fn resolve_href(base_resource: &str, href: &str) -> String {
    let href = href.split('#').next().unwrap_or(href);
    let href = href.split('?').next().unwrap_or(href);
    let href = percent_decode_path(href);
    let base_dir = match base_resource.rfind('/') {
        Some(index) => &base_resource[..index],
        None => "",
    };
    let mut segments: Vec<&str> = Vec::new();
    for segment in base_dir.split('/').filter(|s| !s.is_empty()) {
        if segment != "." {
            segments.push(segment);
        }
    }
    for segment in href.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                segments.pop();
            }
            other => segments.push(other),
        }
    }
    segments.join("/")
}

/// Percent-decodes a URI path component as raw bytes and re-encodes as
/// UTF-8. Invalid or partial escapes are kept literally; if decoding does
/// not produce valid UTF-8, the original string is returned unchanged.
pub(crate) fn percent_decode_path(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut decoded: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%'
            && index + 2 < bytes.len()
            && let (Some(high), Some(low)) =
                (hex_value(bytes[index + 1]), hex_value(bytes[index + 2]))
        {
            decoded.push(high * 16 + low);
            index += 3;
            continue;
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    match String::from_utf8(decoded) {
        Ok(value) => value,
        Err(_) => input.to_string(),
    }
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_href_handles_dots_fragments_and_encoding() {
        assert_eq!(
            resolve_href("OEBPS/content.opf", "text/c1.xhtml"),
            "OEBPS/text/c1.xhtml"
        );
        assert_eq!(
            resolve_href("OEBPS/content.opf", "text/c1.xhtml#note"),
            "OEBPS/text/c1.xhtml"
        );
        assert_eq!(
            resolve_href("OEBPS/text/nav.xhtml", "../images/a.png"),
            "OEBPS/images/a.png"
        );
        assert_eq!(
            resolve_href("OEBPS/content.opf", "My%20Book/c1.xhtml"),
            "OEBPS/My Book/c1.xhtml"
        );
        assert_eq!(
            resolve_href("OEBPS/content.opf", "ch%E1%80%99.xhtml"),
            "OEBPS/ch\u{1019}.xhtml"
        );
    }

    #[test]
    fn percent_decoding_keeps_invalid_escapes_literal() {
        assert_eq!(percent_decode_path("plain/file.xhtml"), "plain/file.xhtml");
        assert_eq!(percent_decode_path("a%2xb"), "a%2xb");
        assert_eq!(percent_decode_path("trailing%"), "trailing%");
        assert_eq!(percent_decode_path("short%a"), "short%a");
        assert_eq!(percent_decode_path("%41%42"), "AB");
    }
}
