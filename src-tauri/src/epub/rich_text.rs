//! Restricted translation fragments. Browser HTML is never trusted.
use crate::epub::preview::escape_html_text;
use crate::error::AppError;
use base64::Engine;

pub const MAX_FRAGMENT: usize = 16 * 1024 * 1024;

pub fn image_bytes(src: &str) -> Result<(&'static str, Vec<u8>), AppError> {
    let invalid = || {
        AppError::new(
            "invalid_image",
            "Choose a PNG, JPEG or GIF image under 8 MB.",
        )
    };
    let (header, payload) = src.split_once(',').ok_or_else(invalid)?;
    let (mime, signature): (&str, &[u8]) = match header {
        "data:image/png;base64" => ("image/png", b"\x89PNG\r\n\x1a\n"),
        "data:image/jpeg;base64" => ("image/jpeg", b"\xff\xd8\xff"),
        "data:image/gif;base64" => ("image/gif", b"GIF8"),
        _ => return Err(invalid()),
    };
    if payload.len() > 12 * 1024 * 1024 {
        return Err(invalid());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload)
        .map_err(|_| invalid())?;
    if bytes.len() > 8 * 1024 * 1024 || !bytes.starts_with(signature) {
        return Err(invalid());
    }
    Ok((mime, bytes))
}

fn validate_image_source(src: &str) -> Result<(), AppError> {
    let invalid = || {
        AppError::new(
            "invalid_image",
            "Choose a PNG, JPEG or GIF image under 8 MB, or keep a relative image from the book.",
        )
    };
    if src.starts_with("data:") {
        image_bytes(src)?;
        return Ok(());
    }
    // Relative EPUB resource references are preserved as-is for export. Reject
    // absolute paths, URL schemes, protocol-relative URLs and Windows paths.
    if src.trim().is_empty()
        || src.starts_with('/')
        || src.starts_with('\\')
        || src.contains(':')
        || src.contains('\\')
        || src.chars().any(char::is_control)
    {
        return Err(invalid());
    }
    Ok(())
}

/// Validates and canonicalizes inline XHTML, deriving authoritative plain text.
pub fn validate(fragment: &str) -> Result<(String, String), AppError> {
    validate_schema(fragment, false)
}

pub fn validate_document(fragment: &str) -> Result<(String, String), AppError> {
    validate_schema(fragment, true)
}

fn validate_schema(fragment: &str, document: bool) -> Result<(String, String), AppError> {
    let invalid = || {
        AppError::new(
            "invalid_translation",
            "The translation contains unsupported formatting or an invalid image.",
        )
    };
    if fragment.len() > MAX_FRAGMENT {
        return Err(invalid());
    }
    // EPUB fragments inherit these prefixes from their outer <html> element.
    // Restore them on the synthetic wrapper after extracting a chapter body.
    let wrapped = format!(
        "<w xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">{fragment}</w>"
    );
    let full = if document {
        roxmltree::Document::parse(fragment).ok().filter(|doc| {
            matches!(doc.root_element().tag_name().name(), "html" | "body")
                && doc.root_element().tag_name().namespace() == Some("http://www.w3.org/1999/xhtml")
        })
    } else {
        None
    };
    let doc = match full { Some(doc) => doc, None => roxmltree::Document::parse(&wrapped).map_err(|error| AppError::new("invalid_translation", format!("The HTML is not well-formed XHTML at {}. Check closing tags and escaped & characters.", error.pos())))? };
    let root = if doc
        .root_element()
        .has_tag_name(("http://www.w3.org/1999/xhtml", "html"))
    {
        doc.root_element()
            .children()
            .find(|node| node.has_tag_name(("http://www.w3.org/1999/xhtml", "body")))
            .ok_or_else(|| {
                AppError::new(
                    "invalid_translation",
                    "The pasted XHTML document has no body element.",
                )
            })?
    } else {
        doc.root_element()
    };
    let mut html = String::new();
    let mut plain = String::new();
    fn walk(
        node: roxmltree::Node<'_, '_>,
        html: &mut String,
        plain: &mut String,
        depth: usize,
        document: bool,
    ) -> Result<(), AppError> {
        let invalid = || {
            AppError::new(
                "invalid_translation",
                "The translation contains unsupported formatting or an invalid image.",
            )
        };
        if depth > 32 {
            return Err(invalid());
        }
        if node.is_text() {
            let text = node.text().unwrap_or("");
            if document
                && !text.trim().is_empty()
                && node.parent_element().is_some_and(|parent| {
                    matches!(
                        parent.tag_name().name(),
                        "table" | "thead" | "tbody" | "tfoot" | "tr"
                    )
                })
            {
                return Err(AppError::new(
                    "invalid_translation",
                    "Table text must be inside a cell.",
                ));
            }
            html.push_str(&escape_html_text(text));
            plain.push_str(text);
            return Ok(());
        }
        if !node.is_element() {
            return Err(invalid());
        }
        let tag = node.tag_name().name();
        if node.tag_name().namespace() != Some("http://www.w3.org/1999/xhtml")
            || !(matches!(tag, "strong" | "em" | "u" | "s" | "br" | "img" | "a")
                || document
                    && matches!(
                        tag,
                        "span"
                            | "div"
                            | "b"
                            | "i"
                            | "sup"
                            | "sub"
                            | "section"
                            | "article"
                            | "aside"
                            | "header"
                            | "footer"
                            | "nav"
                            | "main"
                            | "figure"
                            | "figcaption"
                    )
                || document
                    && matches!(
                        tag,
                        "p" | "h1"
                            | "h2"
                            | "h3"
                            | "h4"
                            | "h5"
                            | "h6"
                            | "ul"
                            | "ol"
                            | "li"
                            | "blockquote"
                            | "hr"
                            | "table"
                            | "thead"
                            | "tbody"
                            | "tfoot"
                            | "tr"
                            | "td"
                            | "th"
                    ))
        {
            return Err(AppError::new(
                "invalid_translation",
                format!("The translation contains unsupported element <{tag}>."),
            ));
        }
        if document {
            let parent = node
                .parent_element()
                .map(|n| n.tag_name().name())
                .unwrap_or("w");
            let is_block = matches!(
                tag,
                "div"
                    | "section"
                    | "article"
                    | "aside"
                    | "header"
                    | "footer"
                    | "nav"
                    | "main"
                    | "figure"
                    | "figcaption"
                    | "p"
                    | "h1"
                    | "h2"
                    | "h3"
                    | "h4"
                    | "h5"
                    | "h6"
                    | "ul"
                    | "ol"
                    | "li"
                    | "blockquote"
                    | "hr"
                    | "table"
                    | "thead"
                    | "tbody"
                    | "tfoot"
                    | "tr"
                    | "td"
                    | "th"
            );
            if matches!(
                parent,
                "p" | "h1"
                    | "h2"
                    | "h3"
                    | "h4"
                    | "h5"
                    | "h6"
                    | "strong"
                    | "em"
                    | "b"
                    | "i"
                    | "sup"
                    | "sub"
                    | "u"
                    | "s"
                    | "a"
                    | "span"
            ) && is_block
            {
                return Err(AppError::new(
                    "invalid_translation",
                    format!(
                        "A <{tag}> block cannot be inside <{parent}>. Place it outside the paragraph or inline element."
                    ),
                ));
            }
            if matches!(parent, "ul" | "ol") && tag != "li" {
                return Err(invalid());
            }
            if tag == "li" && !matches!(parent, "ul" | "ol") {
                return Err(invalid());
            }
            if matches!(parent, "table") && !matches!(tag, "thead" | "tbody" | "tfoot" | "tr")
                || matches!(parent, "thead" | "tbody" | "tfoot") && tag != "tr"
                || parent == "tr" && !matches!(tag, "td" | "th")
            {
                return Err(AppError::new(
                    "invalid_translation",
                    "Tables must contain rows, and rows must contain header or data cells.",
                ));
            }
            if matches!(tag, "td" | "th") && parent != "tr"
                || tag == "tr" && !matches!(parent, "table" | "thead" | "tbody" | "tfoot")
                || matches!(tag, "thead" | "tbody" | "tfoot") && parent != "table"
            {
                return Err(invalid());
            }
            if tag == "table" {
                let rows = node
                    .descendants()
                    .filter(|n| n.has_tag_name(("http://www.w3.org/1999/xhtml", "tr")))
                    .count();
                if rows == 0 || rows > 1000 {
                    return Err(AppError::new(
                        "invalid_translation",
                        "Tables must have between 1 and 1000 rows.",
                    ));
                }
                plain.push_str("[table]");
            }
            if tag == "a"
                && node
                    .ancestors()
                    .skip(1)
                    .any(|n| n.has_tag_name(("http://www.w3.org/1999/xhtml", "a")))
            {
                return Err(invalid());
            }
        }
        for attr in node.attributes() {
            let is_epub_type = document
                && attr.namespace() == Some("http://www.idpf.org/2007/ops")
                && attr.name() == "type";
            let is_standard_attribute = attr.namespace().is_none()
                && (matches!(
                    (tag, attr.name()),
                    ("img", "src" | "alt")
                        | ("a", "href")
                        | ("table", "border")
                        | ("ol", "start")
                        | ("td" | "th", "colspan" | "rowspan")
                ) || document
                    && matches!(
                        attr.name(),
                        "class" | "id" | "style" | "title" | "lang" | "dir" | "role"
                    ));
            if !(is_epub_type || is_standard_attribute) {
                return Err(AppError::new(
                    "invalid_translation",
                    format!(
                        "The translation contains unsupported attribute '{}' on <{tag}>.",
                        attr.name()
                    ),
                ));
            }
        }
        html.push('<');
        html.push_str(tag);
        for attr in node.attributes() {
            if tag == "table"
                && attr.name() == "border"
                && attr
                    .value()
                    .parse::<u16>()
                    .ok()
                    .is_none_or(|border| border > 100)
            {
                return Err(AppError::new(
                    "invalid_translation",
                    "Table border must be an integer from 0 to 100.",
                ));
            }
            if matches!(attr.name(), "colspan" | "rowspan")
                && attr
                    .value()
                    .parse::<u16>()
                    .ok()
                    .is_none_or(|span| span == 0 || span > 100)
            {
                return Err(AppError::new(
                    "invalid_translation",
                    "Table cell spans must be integers from 1 to 100.",
                ));
            }
            if attr.name() == "style" {
                validate_style(attr.value())?;
            }
            if tag == "img" && attr.name() == "src" {
                validate_image_source(attr.value())?;
            }
            if tag == "a" && attr.name() == "href" {
                let value = attr.value();
                if value.contains(':') || value.starts_with('/') || value.starts_with("\\") {
                    return Err(invalid());
                }
            }
            let qualified_name = if attr.namespace() == Some("http://www.idpf.org/2007/ops")
                && attr.name() == "type"
            {
                "epub:type"
            } else {
                attr.name()
            };
            html.push_str(&format!(
                " {qualified_name}=\"{}\"",
                escape_html_text(attr.value())
            ));
        }
        if tag == "img" && node.attribute("src").is_none() {
            return Err(invalid());
        }
        if matches!(tag, "img" | "br" | "hr") {
            if node.children().next().is_some() {
                return Err(invalid());
            }
            html.push_str("/>");
            if tag == "br" {
                plain.push('\n');
            } else {
                plain.push_str("[image]");
            }
        } else {
            html.push('>');
            for child in node.children() {
                walk(child, html, plain, depth + 1, document)?;
            }
            html.push_str(&format!("</{tag}>"));
        }
        Ok(())
    }
    for child in root.children() {
        walk(child, &mut html, &mut plain, 0, document)?;
    }
    Ok((html, plain))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn formatting_and_unicode_round_trip() {
        let (html, text) =
            validate("<strong>မြန်မာ &amp; text</strong><br/><em>Next</em>").expect("valid");
        assert_eq!(text, "မြန်မာ & text\nNext");
        assert!(html.contains("<em>Next</em>"));
    }
    #[test]
    fn rejects_active_content() {
        for html in [
            "<script>x</script>",
            "<em onclick=\"x\">x</em>",
            "<img src=\"https://example.com/a.png\"/>",
            "<a href=\"javascript:alert(1)\">x</a>",
            "<p>x</p>",
        ] {
            assert!(validate(html).is_err(), "{html}");
        }
    }
}

#[cfg(test)]
mod document_tests {
    use super::*;
    #[test]
    fn chapter_structure_is_preserved() {
        let html = "<h1>Title</h1><p>First <em>paragraph</em>.</p><ul><li><p>မြန်မာ</p></li></ul><blockquote><p>Quote</p></blockquote>";
        assert_eq!(validate_document(html).expect("document").0, html);
    }
    #[test]
    fn rejects_invalid_document_nesting_and_scripts() {
        for html in [
            "<p><h1>Nested heading</h1></p>",
            "<ul><p>bad</p></ul>",
            "<li>orphan</li>",
            "<script>bad</script>",
            "<a href=\"x\"><a href=\"y\">bad</a></a>",
        ] {
            assert!(validate_document(html).is_err(), "{html}");
        }
    }
}

/// Permit book typography without network fetches, overlays or active CSS.
pub fn validate_style(style: &str) -> Result<(), AppError> {
    for declaration in style.split(';').filter(|part| !part.trim().is_empty()) {
        let Some((property, value)) = declaration.split_once(':') else {
            return Err(AppError::new(
                "invalid_translation",
                "An inline style must use property: value.",
            ));
        };
        let property_name = property.trim().to_ascii_lowercase();
        let ligature_value = property_name == "font-variant-ligatures"
            && !value.trim().is_empty()
            && value.trim().split_ascii_whitespace().all(|token| {
                matches!(
                    token.to_ascii_lowercase().as_str(),
                    "normal"
                        | "none"
                        | "common-ligatures"
                        | "no-common-ligatures"
                        | "discretionary-ligatures"
                        | "no-discretionary-ligatures"
                        | "historical-ligatures"
                        | "no-historical-ligatures"
                        | "contextual"
                        | "no-contextual"
                )
            });
        let color_function = matches!(property_name.as_str(), "color" | "background-color")
            && ["rgb(", "rgba(", "hsl(", "hsla("].iter().any(|prefix| {
                value
                    .trim()
                    .strip_prefix(prefix)
                    .and_then(|body| body.strip_suffix(')'))
                    .is_some_and(|body| {
                        body.chars().all(|c| {
                            c.is_ascii_digit()
                                || c.is_ascii_whitespace()
                                || matches!(c, '.' | ',' | '%' | '+' | '-' | '/')
                        })
                    })
            });
        if !matches!(
            property_name.as_str(),
            "color"
                | "background-color"
                | "font-weight"
                | "font-style"
                | "font-variant-ligatures"
                | "font-size"
                | "font-family"
                | "line-height"
                | "text-align"
                | "text-decoration"
                | "text-indent"
                | "letter-spacing"
                | "word-spacing"
        ) || property_name == "font-variant-ligatures" && !ligature_value
            || value.contains(['@', '\\', '<', '>'])
            || value.contains(['(', ')']) && !color_function
        {
            return Err(AppError::new(
                "invalid_translation",
                format!(
                    "The inline CSS property {} or its value is not supported. Use text typography styles without URLs or positioning.",
                    property.trim()
                ),
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod copied_document_tests {
    use super::*;
    #[test]
    fn accepts_complete_original_toc_document_and_retains_attributes_links() {
        let input = "<?xml version='1.0' encoding='utf-8'?><html xmlns=\"http://www.w3.org/1999/xhtml\"><head><link rel=\"stylesheet\" href=\"stylesheet.css\"/></head><body><p class=\"border1\" style=\"color:#000000\">Contents</p><p class=\"toc2\"><a href=\"174.html#section\">Chapter 174</a></p></body></html>";
        validate_style("color: rgb(0, 0, 0);").expect("browser color serialization");
        let (html, text) = validate_document(input).expect("original XHTML");
        assert!(html.contains("class=\"toc2\""));
        assert!(html.contains("style=\"color:#000000\""));
        assert!(html.contains("href=\"174.html#section\""));
        assert!(!html.contains("<head"));
        assert!(!html.contains("<?xml"));
        assert!(text.contains("Chapter 174"));
    }
    #[test]
    fn rejects_active_css_and_event_attributes() {
        for input in [
            "<p style=\"background-color:url(https://example.com/a)\">x</p>",
            "<p style=\"position:fixed\">x</p>",
            "<p class=\"toc2\" onclick=\"evil()\">x</p>",
        ] {
            assert!(validate_document(input).is_err());
        }
    }
}

#[cfg(test)]
mod table_tests {
    use super::*;
    #[test]
    fn editable_tables_preserve_structure_and_empty_tables_are_content() {
        let html = "<table><tbody><tr><th colspan=\"1\" rowspan=\"1\"><p>မြန်မာ</p></th><th><p>Header</p></th></tr><tr><td><p>A</p></td><td><p></p></td></tr></tbody></table>";
        let (saved, text) = validate_document(html).expect("table");
        assert_eq!(saved, html);
        assert!(text.contains("မြန်မာ"));
        let (_, text) =
            validate_document("<table><tbody><tr><td><p></p></td></tr></tbody></table>")
                .expect("empty grid");
        assert!(!text.trim().is_empty());
    }
    #[test]
    fn rejects_invalid_table_structure_and_spans() {
        for html in [
            "<table><p>outside cell</p></table>",
            "<table><tr>loose text</tr></table>",
            "<p><table><tr><td>x</td></tr></table></p>",
            "<table><tr><td colspan=\"999999\">x</td></tr></table>",
            "<td>orphan</td>",
        ] {
            assert!(validate_document(html).is_err(), "{html}");
        }
    }
}
