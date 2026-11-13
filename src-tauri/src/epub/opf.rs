//! OPF package document parsing: metadata, manifest, spine and cover
//! detection for EPUB 3 (EPUB 2 parses with a compatibility warning).

use std::collections::HashMap;

use crate::domain::ImportWarning;
use crate::error::AppError;

use super::resolve_href;

const XHTML_MEDIA_TYPE: &str = "application/xhtml+xml";
const DC_NAMESPACE: &str = "http://purl.org/dc/elements/1.1/";

#[derive(Debug, Default, Clone)]
pub struct BookMetadata {
    pub title: Option<String>,
    pub author: Option<String>,
    pub language: Option<String>,
    pub identifier: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ManifestItem {
    pub id: String,
    /// ZIP-root-relative resolved path.
    pub href: String,
    pub media_type: String,
    pub properties: Vec<String>,
}

pub struct ParsedOpf {
    pub metadata: BookMetadata,
    /// Full manifest by item id (for resource lookups like covers).
    pub manifest: HashMap<String, ManifestItem>,
    /// Spine order (invariant: reading order), XHTML items only.
    pub spine_items: Vec<ManifestItem>,
    /// ZIP path of the EPUB 3 navigation document.
    pub nav_href: Option<String>,
    pub ncx_href: Option<String>,
    /// ZIP path of the cover image, when declared.
    pub cover_href: Option<String>,
    pub warnings: Vec<ImportWarning>,
}

pub fn parse_opf(bytes: &[u8], opf_path: &str) -> Result<ParsedOpf, AppError> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| AppError::new("invalid_epub", "The package document is not UTF-8."))?;
    let doc = roxmltree::Document::parse(text)
        .map_err(|_| AppError::new("invalid_epub", "The package document is not valid XML."))?;
    let package = doc.root_element();
    if package.tag_name().name() != "package" {
        return Err(AppError::new(
            "invalid_epub",
            "The package document has an unexpected structure.",
        ));
    }

    let mut warnings = Vec::new();
    let version = package.attribute("version").unwrap_or("");
    // EPUB 2 is supported through its NCX table of contents; reserve the
    // compatibility warning for versions outside the implemented 2.x/3.x set.
    if !version.starts_with("2") && !version.starts_with("3") {
        warnings.push(ImportWarning {
            code: "epub_version".into(),
            message: "This book uses an older EPUB format; some content may be \
                      imported with limited information."
                .into(),
            location: None,
        });
    }

    let mut metadata = BookMetadata::default();
    let mut cover_item_id: Option<String> = None;
    let mut fixed_layout = false;
    let mut manifest: HashMap<String, ManifestItem> = HashMap::new();
    let mut spine_idrefs: Vec<String> = Vec::new();
    let mut nav_href = None;
    let mut cover_href = None;

    for node in package.descendants() {
        if !node.is_element() {
            continue;
        }
        let tag = node.tag_name();
        match tag.name() {
            "title" | "creator" | "language" | "identifier"
                if tag.namespace() == Some(DC_NAMESPACE) =>
            {
                let value = node.text().map(|t| t.trim()).filter(|t| !t.is_empty());
                if let Some(value) = value {
                    let slot = match tag.name() {
                        "title" if metadata.title.is_none() => &mut metadata.title,
                        "creator" if metadata.author.is_none() => &mut metadata.author,
                        "language" if metadata.language.is_none() => &mut metadata.language,
                        "identifier" if metadata.identifier.is_none() => &mut metadata.identifier,
                        _ => continue,
                    };
                    *slot = Some(value.to_string());
                }
            }
            "meta" => {
                if node.attribute("name") == Some("cover") {
                    cover_item_id = node.attribute("content").map(str::to_string);
                }
                if node.attribute("property") == Some("rendition:layout")
                    && node.attribute("content") == Some("pre-paginated")
                {
                    fixed_layout = true;
                }
            }
            "item" => {
                if let Some(item) = parse_manifest_item(node, opf_path) {
                    if item.properties.iter().any(|p| p == "nav") {
                        nav_href = Some(item.href.clone());
                    }
                    if item.properties.iter().any(|p| p == "cover-image") {
                        cover_href = Some(item.href.clone());
                    }
                    manifest.insert(item.id.clone(), item);
                }
            }
            "itemref" => {
                if let Some(idref) = node.attribute("idref") {
                    spine_idrefs.push(idref.to_string());
                }
            }
            _ => {}
        }
    }

    if fixed_layout {
        warnings.push(ImportWarning {
            code: "fixed_layout".into(),
            message: "This is a fixed-layout book; it is intended for exact \
                      page rendering and is only partially supported."
                .into(),
            location: None,
        });
    }
    if metadata.title.is_none() {
        warnings.push(ImportWarning {
            code: "metadata_missing".into(),
            message: "The book does not declare a title; a placeholder name \
                      will be used."
                .into(),
            location: None,
        });
    }

    // Legacy <meta name="cover"> points at the cover manifest item.
    if cover_href.is_none()
        && let Some(id) = cover_item_id.as_deref().and_then(|id| manifest.get(id))
    {
        cover_href = Some(id.href.clone());
    }

    let mut spine_items = Vec::new();
    for idref in &spine_idrefs {
        match manifest.get(idref) {
            Some(item) if item.media_type == XHTML_MEDIA_TYPE => {
                spine_items.push(item.clone());
            }
            Some(item) => {
                warnings.push(ImportWarning {
                    code: "spine_non_xhtml".into(),
                    message: "A reading-order entry that is not an XHTML \
                              document was skipped."
                        .into(),
                    location: Some(item.href.clone()),
                });
            }
            None => {
                warnings.push(ImportWarning {
                    code: "spine_reference_broken".into(),
                    message: "A reading-order entry refers to a missing file \
                              and was skipped."
                        .into(),
                    location: None,
                });
            }
        }
    }

    let ncx_href = package
        .children()
        .find(|node| node.is_element() && node.tag_name().name() == "spine")
        .and_then(|node| node.attribute("toc"))
        .and_then(|id| manifest.get(id))
        .filter(|item| item.media_type == "application/x-dtbncx+xml")
        .map(|item| item.href.clone());

    Ok(ParsedOpf {
        metadata,
        manifest,
        spine_items,
        nav_href,
        ncx_href,
        cover_href,
        warnings,
    })
}

fn parse_manifest_item(node: roxmltree::Node<'_, '_>, opf_path: &str) -> Option<ManifestItem> {
    let id = node.attribute("id")?;
    let href = node.attribute("href")?;
    let media_type = node.attribute("media-type").unwrap_or("").to_string();
    let properties = node
        .attribute("properties")
        .map(|value| value.split_whitespace().map(str::to_string).collect())
        .unwrap_or_default();
    Some(ManifestItem {
        id: id.to_string(),
        href: resolve_href(opf_path, href),
        media_type,
        properties,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const OPF: &str = r#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
 <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:identifier id="uid">urn:uuid:1234</dc:identifier>
  <dc:title>Riverside Tales</dc:title>
  <dc:creator>A. Author</dc:creator>
  <dc:language>en</dc:language>
  <meta name="cover" content="cover-img"/>
 </metadata>
 <manifest>
  <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  <item id="c1" href="text/chapter01.xhtml" media-type="application/xhtml+xml"/>
  <item id="cover-img" href="images/cover.png" media-type="image/png"/>
 </manifest>
 <spine>
  <itemref idref="c1"/>
 </spine>
</package>"#;

    #[test]
    fn parses_metadata_manifest_spine_and_cover() {
        let parsed = parse_opf(OPF.as_bytes(), "OEBPS/content.opf").expect("parse opf");
        assert_eq!(parsed.metadata.title.as_deref(), Some("Riverside Tales"));
        assert_eq!(parsed.metadata.author.as_deref(), Some("A. Author"));
        assert_eq!(parsed.metadata.language.as_deref(), Some("en"));
        assert_eq!(parsed.spine_items.len(), 1);
        assert_eq!(parsed.spine_items[0].href, "OEBPS/text/chapter01.xhtml");
        assert_eq!(parsed.nav_href.as_deref(), Some("OEBPS/nav.xhtml"));
        assert_eq!(parsed.cover_href.as_deref(), Some("OEBPS/images/cover.png"));
        assert!(parsed.warnings.is_empty());
    }

    #[test]
    fn accepts_epub2_version_and_still_warns_on_missing_title() {
        let opf = OPF.replacen("version=\"3.0\"", "version=\"2.0\"", 1);
        let opf = opf.replacen("<dc:title>Riverside Tales</dc:title>", "", 1);
        let parsed = parse_opf(opf.as_bytes(), "content.opf").expect("parse opf");
        assert!(!parsed.warnings.iter().any(|w| w.code == "epub_version"));
        assert!(parsed.warnings.iter().any(|w| w.code == "metadata_missing"));
    }

    #[test]
    fn reads_epub2_ncx_reference_from_the_spine() {
        let opf = OPF
            .replacen("version=\"3.0\"", "version=\"2.0\"", 1)
            .replacen(
                "<item id=\"cover-img\" href=\"images/cover.png\" media-type=\"image/png\"/>",
                "<item id=\"cover-img\" href=\"images/cover.png\" media-type=\"image/png\"/>\n  <item id=\"ncx\" href=\"toc.ncx\" media-type=\"application/x-dtbncx+xml\"/>",
                1,
            )
            .replacen("<spine>", "<spine toc=\"ncx\">", 1);
        let parsed = parse_opf(opf.as_bytes(), "OEBPS/content.opf").expect("parse epub2 opf");
        assert_eq!(parsed.ncx_href.as_deref(), Some("OEBPS/toc.ncx"));
        assert!(!parsed.warnings.iter().any(|w| w.code == "epub_version"));
    }

    #[test]
    fn warns_on_broken_spine_references() {
        let opf = OPF.replacen("<itemref idref=\"c1\"/>", "<itemref idref=\"ghost\"/>", 1);
        let parsed = parse_opf(opf.as_bytes(), "content.opf").expect("parse opf");
        assert!(parsed.spine_items.is_empty());
        assert!(
            parsed
                .warnings
                .iter()
                .any(|w| w.code == "spine_reference_broken")
        );
    }
}
