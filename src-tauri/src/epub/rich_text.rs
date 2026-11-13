//! Restricted translation fragments. Browser HTML is never trusted.
use crate::epub::preview::escape_html_text;
use crate::error::AppError;
use base64::Engine;

pub const MAX_FRAGMENT: usize = 16 * 1024 * 1024;

pub fn image_bytes(src: &str) -> Result<(&'static str, Vec<u8>), AppError> {
    let invalid = || {
        AppError::new(
            "invalid_image",
            "Choose a PNG, JPEG, GIF, WebP, AVIF or BMP image under 8 MB.",
        )
    };
    let (header, payload) = src.split_once(',').ok_or_else(invalid)?;
    let mime: &'static str = match header {
        "data:image/png;base64" => "image/png",
        "data:image/jpeg;base64" => "image/jpeg",
        "data:image/gif;base64" => "image/gif",
        "data:image/webp;base64" => "image/webp",
        "data:image/avif;base64" => "image/avif",
        "data:image/bmp;base64" => "image/bmp",
        _ => return Err(invalid()),
    };
    if payload.len() > 12 * 1024 * 1024 {
        return Err(invalid());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload)
        .map_err(|_| invalid())?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err(invalid());
    }
    let signature_ok = match mime {
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => bytes.starts_with(b"\xff\xd8\xff"),
        "image/gif" => bytes.starts_with(b"GIF8"),
        "image/webp" => bytes.len() >= 12 && bytes.starts_with(b"RIFF") && bytes[8..12] == *b"WEBP",
        "image/avif" => {
            bytes.len() >= 12
                && bytes[4..8] == *b"ftyp"
                && (bytes[8..12] == *b"avif" || bytes[8..12] == *b"avis")
        }
        "image/bmp" => bytes.starts_with(b"BM"),
        _ => false,
    };
    if !signature_ok {
        return Err(invalid());
    }
    Ok((mime, bytes))
}

/// Validates and canonicalizes inline XHTML, deriving authoritative plain text.
pub fn validate(fragment: &str) -> Result<(String, String), AppError> {
    validate_schema(fragment, false)
}

pub fn validate_document(fragment: &str) -> Result<(String, String), AppError> {
    validate_schema(fragment, true)
}

const XHTML_NS: &str = "http://www.w3.org/1999/xhtml";
const SVG_NS: &str = "http://www.w3.org/2000/svg";
const XLINK_NS: &str = "http://www.w3.org/1999/xlink";
const EPUB_NS: &str = "http://www.idpf.org/2007/ops";

/// Original book structures that travel with the text. Mirrors the read-only
/// preview allowlist so anything the reader shows can also be kept in a
/// translation draft instead of rejected as "unsupported formatting".
fn is_xhtml_document_tag(tag: &str) -> bool {
    matches!(
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
            | "colgroup"
            | "col"
            | "thead"
            | "tbody"
            | "tfoot"
            | "tr"
            | "td"
            | "th"
            | "caption"
            | "div"
            | "section"
            | "article"
            | "main"
            | "header"
            | "footer"
            | "aside"
            | "nav"
            | "figure"
            | "figcaption"
            | "pre"
            | "dl"
            | "dt"
            | "dd"
            | "span"
            | "b"
            | "i"
            | "code"
            | "sup"
            | "sub"
            | "ruby"
            | "rt"
            | "rp"
            | "picture"
            | "source"
            | "small"
            | "abbr"
            | "cite"
            | "dfn"
            | "kbd"
            | "samp"
            | "var"
            | "mark"
    )
}

fn is_xhtml_block(tag: &str) -> bool {
    matches!(
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
            | "colgroup"
            | "thead"
            | "tbody"
            | "tfoot"
            | "tr"
            | "td"
            | "th"
            | "caption"
            | "div"
            | "section"
            | "article"
            | "main"
            | "header"
            | "footer"
            | "aside"
            | "nav"
            | "figure"
            | "figcaption"
            | "pre"
            | "dl"
            | "dt"
            | "dd"
    )
}

fn is_xhtml_inline(tag: &str) -> bool {
    matches!(
        tag,
        "strong"
            | "em"
            | "u"
            | "s"
            | "br"
            | "img"
            | "a"
            | "span"
            | "b"
            | "i"
            | "code"
            | "sup"
            | "sub"
            | "ruby"
            | "rt"
            | "rp"
            | "picture"
            | "source"
    )
}

fn is_svg_tag(tag: &str) -> bool {
    matches!(
        tag,
        "svg"
            | "g"
            | "image"
            | "path"
            | "rect"
            | "circle"
            | "ellipse"
            | "line"
            | "polyline"
            | "polygon"
            | "title"
            | "desc"
            | "text"
            | "tspan"
    )
}

/// Detects a book image mime from magic bytes. Used for editor display
/// (data URLs) so WebP/AVIF/BMP books behave like PNG/JPEG/GIF instead of
/// showing broken images in chapters that contain them.
pub fn image_mime_from_bytes(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF8") {
        Some("image/gif")
    } else if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && bytes[8..12] == *b"WEBP" {
        Some("image/webp")
    } else if bytes.len() >= 12
        && bytes[4..8] == *b"ftyp"
        && (bytes[8..12] == *b"avif" || bytes[8..12] == *b"avis")
    {
        Some("image/avif")
    } else if bytes.starts_with(b"BM") {
        Some("image/bmp")
    } else {
        None
    }
}

/// Validates an <img>/<source> srcset value: every candidate URL must stay
/// inside the book (relative) or be a supported data URL. Descriptors
/// (`1x`, `400w`) are ignored. Rejects external/network URLs so drafts can
/// never fetch.
fn validate_srcset(value: &str) -> Result<(), AppError> {
    if value.trim().is_empty() {
        return Err(invalid_detail("An image srcset is empty.".to_string()));
    }
    for candidate in value.split(',') {
        let url = candidate.split_whitespace().next().unwrap_or("").trim();
        if url.is_empty() {
            return Err(invalid_detail(
                "An image srcset entry is empty.".to_string(),
            ));
        }
        if url.trim_start().starts_with("data:") {
            image_bytes(url)?;
        } else if !is_relative_resource(url) {
            return Err(invalid_detail(format!(
                "Unsupported image srcset URL \"{url}\": use book-relative images."
            )));
        }
    }
    Ok(())
}

/// Relative resource references that stay inside the book archive.
/// Data URLs are handled separately; anything with a scheme, an absolute
/// path or a network reference is rejected so drafts can never fetch.
fn is_relative_resource(value: &str) -> bool {
    if value.is_empty() {
        return false;
    }
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.contains(':')
        || trimmed.starts_with('/')
        || trimmed.starts_with('\\')
        || trimmed.starts_with("//")
    {
        return false;
    }
    true
}

fn is_safe_external_link(value: &str) -> bool {
    // Book-preserved outbound links. Preview never fetches them (rewritten
    // inert); export keeps the original reference. Active schemes stay
    // rejected so drafts can never execute script or exfiltrate.
    let lower = value.trim_start().to_ascii_lowercase();
    (lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:"))
        && !lower.starts_with("javascript:")
        && !lower.starts_with("data:")
        && !lower.starts_with("vbscript:")
}

fn is_safe_kindle_embed_link(value: &str) -> bool {
    // Legacy Kindle EPUBs use this opaque, non-network scheme to link to an
    // embedded image. Keep only a hexadecimal resource id and a known image
    // MIME type; arbitrary kindle: URLs and extra parameters remain rejected.
    let lower = value.trim().to_ascii_lowercase();
    let Some(reference) = lower.strip_prefix("kindle:embed:") else {
        return false;
    };
    let (id, mime) = reference
        .split_once('?')
        .map_or((reference, None), |(id, query)| (id, Some(query)));
    !id.is_empty()
        && id.len() <= 16
        && id.bytes().all(|byte| byte.is_ascii_hexdigit())
        && mime.is_none_or(|mime| {
            matches!(
                mime,
                "mime=image/jpg"
                    | "mime=image/jpeg"
                    | "mime=image/png"
                    | "mime=image/gif"
                    | "mime=image/webp"
            )
        })
}

/// Presentational attributes real EPUBs carry on tables/cells/images.
/// Inert strings only; event handlers, URLs and positioning CSS are handled
/// separately. Values are escaped on serialization.
fn is_preserved_layout_attr(tag: &str, name: &str) -> bool {
    matches!(
        (tag, name),
        (
            "table",
            "border" | "cellpadding" | "cellspacing" | "width" | "align"
        ) | ("colgroup" | "col", "span" | "width")
            | (
                "td" | "th",
                "width" | "height" | "align" | "valign" | "scope" | "abbr" | "headers"
            )
            | ("img", "width" | "height" | "align")
            | ("ol" | "ul", "type")
            | ("li", "value")
    )
}

fn invalid_detail(why: String) -> AppError {
    AppError::new(
        "invalid_translation",
        format!("The translation contains unsupported formatting or an invalid image. {why}"),
    )
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
    // Declare the book namespaces up front so body-inner fragments copied
    // from the original (which may use epub:type or xlink:href while the
    // declaring xmlns lives on <html>) still parse as standalone XML.
    let wrapped = format!(
        "<w xmlns=\"{XHTML_NS}\" xmlns:epub=\"{EPUB_NS}\" xmlns:xlink=\"{XLINK_NS}\">{fragment}</w>"
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
        if depth > 32 {
            return Err(invalid_detail("Content is nested too deeply.".to_string()));
        }
        if node.is_text() {
            let text = node.text().unwrap_or("");
            if document
                && !text.trim().is_empty()
                && node.parent_element().is_some_and(|parent| {
                    matches!(
                        parent.tag_name().name(),
                        "table" | "colgroup" | "thead" | "tbody" | "tfoot" | "tr"
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
            return Err(invalid_detail(
                "Only text and known elements are supported.".to_string(),
            ));
        }
        let tag = node.tag_name().name();
        let ns = node.tag_name().namespace();
        let is_svg = ns == Some(SVG_NS);
        let is_xhtml = ns == Some(XHTML_NS);
        // A line break has no meaning in a table column definition. Some
        // editors insert <br> while reserializing whitespace in <colgroup>;
        // discard only that invalid, content-free node and retain every <col>.
        if document
            && is_xhtml
            && tag == "br"
            && node
                .parent_element()
                .is_some_and(|parent| parent.tag_name().name() == "colgroup")
        {
            return Ok(());
        }
        // `<br>` has no meaning in SVG. Some Rich-text serializers insert it
        // between SVG children while normalizing whitespace; discard only
        // this empty, content-free node so the actual artwork is preserved.
        if document
            && is_svg
            && tag == "br"
            && node
                .parent_element()
                .is_some_and(|parent| parent.tag_name().namespace() == Some(SVG_NS))
        {
            return Ok(());
        }
        // Inline (legacy block) fragments keep the original tight schema.
        // Whole-chapter documents accept the reader's structural and SVG
        // tags so copied originals round-trip instead of being rejected.
        let allowed = if is_xhtml {
            matches!(tag, "strong" | "em" | "u" | "s" | "br" | "img" | "a")
                || (document && (is_xhtml_document_tag(tag) || is_xhtml_inline(tag)))
        } else if document && is_svg {
            is_svg_tag(tag)
        } else {
            false
        };
        if !allowed {
            let ns_label: String = match ns {
                Some(SVG_NS) => " (SVG namespace)".to_string(),
                Some(XHTML_NS) => String::new(),
                Some(other) => format!(" (namespace {other})"),
                None => " (no namespace)".to_string(),
            };
            // This is the rejection the AI dialog surfaces. Name the element
            // so Retry can drop/convert exactly this tag.
            return Err(invalid_detail(format!(
                "Unsupported <{tag}>{ns_label} element."
            )));
        }
        if document {
            let (parent_tag, parent_ns) = node
                .parent_element()
                .map(|n| (n.tag_name().name().to_string(), n.tag_name().namespace()))
                .unwrap_or(("w".to_string(), None));
            let parent = parent_tag.as_str();
            // SVG subtrees stay SVG-only: book XHTML must not appear inside
            // a drawing, and drawings behave like blocks in running text.
            if parent_ns == Some(SVG_NS) && !is_svg && !node.is_text() {
                return Err(invalid_detail(format!(
                    "A <{tag}> element cannot appear inside SVG <{parent}>."
                )));
            }
            let is_block = (is_xhtml && is_xhtml_block(tag)) || is_svg && tag == "svg";
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
                    | "u"
                    | "s"
                    | "a"
                    | "span"
                    | "b"
                    | "i"
                    | "code"
                    | "sup"
                    | "sub"
                    | "ruby"
                    | "rt"
                    | "rp"
                    | "small"
                    | "abbr"
                    | "cite"
                    | "dfn"
                    | "kbd"
                    | "samp"
                    | "var"
                    | "mark"
            ) && (is_block || is_svg)
            {
                return Err(AppError::new(
                    "invalid_translation",
                    format!(
                        "A <{tag}> block cannot be inside <{parent}>. Place it outside the paragraph or inline element."
                    ),
                ));
            }
            if matches!(parent, "ul" | "ol") && tag != "li" {
                return Err(invalid_detail(format!(
                    "Only <li> can appear inside <{parent}>, found <{tag}>."
                )));
            }
            if tag == "li" && !matches!(parent, "ul" | "ol") {
                return Err(invalid_detail(
                    "<li> must appear inside <ul> or <ol>.".to_string(),
                ));
            }
            if tag == "source" && parent != "picture" {
                return Err(invalid_detail(
                    "<source> must appear inside <picture>.".to_string(),
                ));
            }
            if parent == "picture" && !matches!(tag, "source" | "img") {
                return Err(invalid_detail(format!(
                    "Only <source> or <img> can appear inside <picture>, found <{tag}>."
                )));
            }
            let invalid_table_child = if parent == "table"
                && !matches!(
                    tag,
                    "caption" | "colgroup" | "thead" | "tbody" | "tfoot" | "tr"
                ) {
                Some("A table can contain captions, column groups, row groups, or rows.")
            } else if parent == "colgroup" && tag != "col" {
                Some("A column group can contain only <col> elements.")
            } else if matches!(parent, "thead" | "tbody" | "tfoot") && tag != "tr" {
                Some("A table row group can contain only <tr> elements.")
            } else if parent == "tr" && !matches!(tag, "td" | "th") {
                Some("A table row can contain only <td> or <th> cells.")
            } else {
                None
            };
            if let Some(reason) = invalid_table_child {
                return Err(AppError::new(
                    "invalid_translation",
                    format!("{reason} Found <{tag}> inside <{parent}>."),
                ));
            }
            if matches!(tag, "td" | "th") && parent != "tr"
                || tag == "colgroup" && parent != "table"
                || tag == "col" && parent != "colgroup"
                || tag == "tr" && !matches!(parent, "table" | "thead" | "tbody" | "tfoot")
                || matches!(tag, "thead" | "tbody" | "tfoot" | "caption") && parent != "table"
            {
                return Err(invalid_detail(format!(
                    "A <{tag}> element is in the wrong table position (parent <{parent}>)."
                )));
            }
            if tag == "table" {
                let rows = node
                    .descendants()
                    .filter(|n| n.has_tag_name((XHTML_NS, "tr")))
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
                    .any(|n| n.has_tag_name((XHTML_NS, "a")))
            {
                return Err(invalid_detail(
                    "Links cannot be nested inside another link.".to_string(),
                ));
            }
            if is_svg && tag == "image" && node.children().next().is_some() {
                return Err(invalid_detail(
                    "An SVG <image> must stay empty.".to_string(),
                ));
            }
        }
        // Attribute policy: unprefixed book attributes plus the namespaced
        // attributes originals rely on (SVG image references, EPUB semantics
        // and xml:lang). Everything else — event handlers, scripts, network
        // CSS — stays rejected.
        let paragraph_color = if document && is_xhtml && tag == "p" {
            node.attribute("color")
        } else {
            None
        };
        if let Some(color) = paragraph_color {
            validate_style(&format!("color:{color}"))?;
        }
        for attr in node.attributes() {
            let attr_ns = attr.namespace();
            let attr_name = attr.name();
            let namespaced_ok = document
                && ((attr_ns == Some(XLINK_NS) && attr_name == "href" && is_svg && tag == "image")
                    || (attr_ns == Some(EPUB_NS) && attr_name == "type" && is_xhtml)
                    || (attr_ns == Some("http://www.w3.org/XML/1998/namespace")
                        && attr_name == "lang"));
            if namespaced_ok {
                continue;
            }
            if attr_ns.is_some() {
                return Err(invalid_detail(format!(
                    "Unsupported attribute '{}' on <{tag}>.",
                    attr.name()
                )));
            }
            // Event-handler attributes are never book formatting.
            if attr_name.len() > 1 && attr_name.to_ascii_lowercase().starts_with("on") {
                return Err(invalid_detail(format!(
                    "Event attribute '{attr_name}' on <{tag}> is not supported."
                )));
            }
            let per_tag_ok = matches!(
                (tag, attr_name),
                (
                    "img",
                    "src" | "alt" | "srcset" | "sizes" | "loading" | "decoding"
                ) | ("image", "href" | "alt")
                    | ("source", "src" | "srcset" | "sizes" | "media" | "type")
                    | ("a", "href")
                    | ("ol", "start")
                    | ("td" | "th", "colspan" | "rowspan")
            ) || (is_svg
                && matches!(
                    attr_name,
                    "viewBox"
                        | "preserveAspectRatio"
                        | "width"
                        | "height"
                        | "x"
                        | "y"
                        | "x1"
                        | "x2"
                        | "y1"
                        | "y2"
                        | "cx"
                        | "cy"
                        | "r"
                        | "rx"
                        | "ry"
                        | "d"
                        | "points"
                        | "transform"
                        | "opacity"
                        | "fill"
                        | "stroke"
                        | "stroke-width"
                        | "font-size"
                        | "text-anchor"
                        | "version"
                ));
            if !(per_tag_ok
                || paragraph_color.is_some() && attr_name == "color"
                // Accept old/book targets, then omit them on serialization.
                || document && is_xhtml && tag == "a" && attr_name == "target"
                || document
                    && (matches!(
                        attr_name,
                        "class" | "id" | "style" | "title" | "lang" | "dir" | "role"
                    ) || attr_name.starts_with("aria-")
                        || attr_name == "xml:lang"
                        || is_preserved_layout_attr(tag, attr_name)))
            {
                return Err(invalid_detail(format!(
                    "Unsupported attribute '{attr_name}' on <{tag}>."
                )));
            }
        }
        // Serialize with self-contained namespaces: an <svg> root carries
        // its SVG/XLink declarations so the stored body-inner fragment stays
        // well-formed when spliced back into the original chapter, and
        // EPUB semantics keep a local declaration for the same reason.
        // SVG image references are normalized to both href forms so legacy
        // (xlink) and current readers resolve the same file.
        let mut needs_epub_ns = false;
        let mut svg_image_href: Option<String> = None;
        if is_svg && tag == "svg" {
            html.push_str(
                "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"",
            );
        } else if is_svg && tag == "image" {
            html.push_str("<image");
        } else {
            html.push('<');
            html.push_str(tag);
        }
        for attr in node.attributes() {
            let attr_ns = attr.namespace();
            let attr_name = attr.name();
            // Browsing-context targets are unnecessary in translated books.
            // Normalize them away, including when reopening an older draft.
            if document && is_xhtml && tag == "a" && attr_ns.is_none() && attr_name == "target" {
                continue;
            }
            // Normalize legacy HTML paragraph colors to safe XHTML inline CSS.
            if paragraph_color.is_some() && matches!(attr_name, "color" | "style") {
                continue;
            }
            if attr_ns == Some(XLINK_NS) && attr_name == "href" {
                svg_image_href = Some(attr.value().to_string());
                continue;
            }
            if attr_ns == Some(EPUB_NS) && attr_name == "type" {
                needs_epub_ns = true;
                html.push_str(&format!(
                    " epub:type=\"{}\"",
                    escape_html_text(attr.value())
                ));
                continue;
            }
            if attr_ns == Some("http://www.w3.org/XML/1998/namespace") && attr_name == "lang" {
                html.push_str(&format!(" xml:lang=\"{}\"", escape_html_text(attr.value())));
                continue;
            }
            if tag == "table" && attr_name == "border" {
                if attr
                    .value()
                    .parse::<u16>()
                    .ok()
                    .is_none_or(|border| border > 100)
                {
                    return Err(invalid_detail(
                        "Table border must be an integer from 0 to 100.".to_string(),
                    ));
                }
            }
            if matches!(attr_name, "colspan" | "rowspan" | "span")
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
            if attr_name == "style" {
                validate_style(attr.value())?;
            }
            if tag == "img" && attr_name == "src" {
                let value = attr.value();
                if value.trim_start().starts_with("data:") {
                    image_bytes(value)?;
                } else if !is_relative_resource(value) {
                    return Err(invalid_detail(format!(
                        "Unsupported <img src=\"{value}\">: use a book-relative image or a PNG/JPEG/GIF/WebP/AVIF/BMP data URL under 8 MB."
                    )));
                }
            }
            if (tag == "img" || tag == "source") && attr_name == "srcset" {
                validate_srcset(attr.value())?;
            }
            if (tag == "img" || tag == "source") && attr_name == "sizes" {
                let value = attr.value();
                if value.contains("javascript:")
                    || value.contains("data:")
                    || value.contains("vbscript:")
                    || value.contains('<')
                    || value.contains('>')
                {
                    return Err(invalid_detail(format!(
                        "Unsupported sizes value on <{tag}>."
                    )));
                }
            }
            if tag == "source" && attr_name == "media" {
                let value = attr.value();
                if value.contains("javascript:")
                    || value.contains("data:")
                    || value.contains("vbscript:")
                    || value.contains('<')
                    || value.contains('>')
                {
                    return Err(invalid_detail(
                        "Unsupported media value on <source>.".to_string(),
                    ));
                }
            }
            if tag == "source" && attr_name == "type" {
                let value = attr.value().trim().to_ascii_lowercase();
                if !(value.starts_with("image/") || value.is_empty()) {
                    return Err(invalid_detail(format!(
                        "Unsupported <source type=\"{}\">: only image types are preserved.",
                        attr.value()
                    )));
                }
            }
            if tag == "img" && matches!(attr_name, "loading" | "decoding") {
                let value = attr.value().trim().to_ascii_lowercase();
                let ok = match attr_name {
                    "loading" => matches!(value.as_str(), "lazy" | "eager" | "auto"),
                    _ => matches!(value.as_str(), "async" | "sync" | "auto"),
                };
                if !ok {
                    return Err(invalid_detail(format!(
                        "Unsupported <img {attr_name}=\"{}\">.",
                        attr.value()
                    )));
                }
            }
            if tag == "source" && attr_name == "src" {
                let value = attr.value();
                if value.trim_start().starts_with("data:") {
                    image_bytes(value)?;
                } else if !is_relative_resource(value) {
                    return Err(invalid_detail(format!(
                        "Unsupported <source src=\"{value}\">: use a book-relative image."
                    )));
                }
            }
            if is_svg && tag == "image" && attr_name == "href" {
                svg_image_href = Some(attr.value().to_string());
                continue;
            }
            if tag == "a" && attr_name == "href" {
                // Book-relative links and in-chapter anchors ("#note") always
                // travel. Preserved outbound http(s)/mailto links are kept so
                // a correctly-translated proposal is not rejected; preview
                // keeps them inert and export carries the original reference.
                // Anything else with a scheme or absolute path stays rejected.
                let value = attr.value();
                if !is_relative_resource(value)
                    && !(value.starts_with('#') && !value.contains(':'))
                    && !(document && is_safe_external_link(value))
                    && !(document && is_safe_kindle_embed_link(value))
                {
                    return Err(invalid_detail(format!(
                        "Unsupported <a href=\"{value}\">: use a book-relative link, an in-chapter #anchor, or http(s)/mailto."
                    )));
                }
            }
            // The xmlns declarations themselves are namespace bindings, not
            // attributes in roxmltree, so re-emitting them would duplicate.
            if attr_name == "xmlns" || attr_name.starts_with("xmlns:") {
                continue;
            }
            html.push_str(&format!(
                " {}=\"{}\"",
                attr_name,
                escape_html_text(attr.value())
            ));
        }
        if let Some(color) = paragraph_color {
            let style = node
                .attribute("style")
                .map(|existing| format!("{existing};color:{color}"))
                .unwrap_or_else(|| format!("color:{color}"));
            validate_style(&style)?;
            html.push_str(&format!(" style=\"{}\"", escape_html_text(&style)));
        }
        if is_svg && tag == "image" {
            let href = svg_image_href.filter(|v| !v.is_empty()).ok_or_else(|| {
                invalid_detail("An SVG <image> needs an href to a book-relative image.".to_string())
            })?;
            if href.trim_start().starts_with("data:") {
                image_bytes(&href)?;
            } else if !is_relative_resource(&href) {
                return Err(invalid_detail(format!(
                    "Unsupported SVG image href \"{href}\": use a book-relative image."
                )));
            }
            let escaped = escape_html_text(&href);
            html.push_str(&format!(" href=\"{escaped}\" xlink:href=\"{escaped}\""));
        }
        if needs_epub_ns {
            html.push_str(" xmlns:epub=\"http://www.idpf.org/2007/ops\"");
        }
        if tag == "img" && node.attribute("src").is_none() {
            return Err(invalid_detail("<img> needs a src attribute.".to_string()));
        }
        if tag == "source" && node.attribute("src").is_none() && node.attribute("srcset").is_none()
        {
            return Err(invalid_detail(
                "<source> needs a src or srcset attribute.".to_string(),
            ));
        }
        if matches!(tag, "img" | "br" | "hr" | "source" | "col")
            || (is_svg
                && matches!(
                    tag,
                    "image"
                        | "path"
                        | "rect"
                        | "circle"
                        | "ellipse"
                        | "line"
                        | "polyline"
                        | "polygon"
                ))
        {
            if node.children().next().is_some() {
                return Err(invalid_detail(format!("<{tag}> must stay empty.")));
            }
            html.push_str("/>");
            if tag == "br" {
                plain.push('\n');
            } else if tag == "img" || tag == "source" || (is_svg && tag == "image") {
                plain.push_str("[image]");
            }
        } else {
            html.push('>');
            for child in node.children() {
                walk(child, html, plain, depth + 1, document)?;
            }
            if is_svg && tag == "svg" {
                html.push_str("</svg>");
            } else if is_svg && tag == "image" {
                html.push_str("</image>");
            } else {
                html.push_str(&format!("</{tag}>"));
            }
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

    #[test]
    fn preserves_safe_legacy_kindle_embedded_image_links() {
        let source = "<p><a href=\"kindle:embed:0003?mime=image/jpg\"><img src=\"cover.jpg\" alt=\"Cover\"/></a></p>";
        let (saved, _) = validate_document(source).expect("legacy embedded image link");
        assert!(saved.contains("href=\"kindle:embed:0003?mime=image/jpg\""));
        assert!(saved.contains("src=\"cover.jpg\""));

        for href in [
            "kindle:execute:0003",
            "kindle:embed:0003?mime=text/html",
            "kindle:embed:0003?mime=image/png&url=https://example.com",
            "kindle:embed:../../secret?mime=image/jpg",
        ] {
            assert!(
                validate_document(&format!("<a href=\"{href}\">image</a>")).is_err(),
                "{href}"
            );
        }
    }

    #[test]
    fn table_errors_name_the_invalid_cell_or_row_tag() {
        let error = validate_document("<table><tbody><tr><p>Cell text</p></tr></tbody></table>")
            .expect_err("a row cannot contain a paragraph instead of a cell");
        assert!(
            error
                .message
                .contains("A table row can contain only <td> or <th> cells."),
            "{}",
            error.message
        );
        assert!(
            error.message.contains("Found <p> inside <tr>."),
            "{}",
            error.message
        );
    }

    #[test]
    fn stray_breaks_inside_column_groups_are_removed_without_losing_columns() {
        let html = "<table><colgroup><col/><br/><col/></colgroup><tbody><tr><td>မြန်မာ</td></tr></tbody></table>";
        let (saved, _) = validate_document(html).expect("recover stray column-group break");
        assert!(
            saved.contains("<colgroup><col/><col/></colgroup>"),
            "{saved}"
        );
        assert!(!saved.contains("<br"), "{saved}");
        assert!(saved.contains("<td>မြန်မာ</td>"), "{saved}");
    }
    #[test]
    fn preserved_book_links_layout_attrs_and_xml_lang_round_trip() {
        // Real books carry outbound links, xml:lang and table presentational
        // attributes. A proposal that preserves them must not be rejected.
        let html = "<p xml:lang=\"en\">See <a href=\"https://example.com/page\">site</a> and <a href=\"mailto:a@example.com\">mail</a></p><table border=\"1\" cellpadding=\"4\"><tbody><tr><td align=\"center\" valign=\"top\" scope=\"col\">Hi</td></tr></tbody></table>";
        let (saved, _) = validate_document(html).expect("preserved book attrs");
        assert!(saved.contains("https://example.com/page"), "{saved}");
        assert!(saved.contains("xml:lang=\"en\""), "{saved}");
        assert!(saved.contains("border=\"1\""), "{saved}");
        // Active schemes and handlers still fail, with a named reason.
        for bad in [
            "<p><a href=\"javascript:alert(1)\">x</a></p>",
            "<p onclick=\"evil()\">x</p>",
            "<p><font>old</font></p>",
        ] {
            let err = validate_document(bad).expect_err(bad);
            assert!(
                err.message.contains("unsupported formatting")
                    && (err.message.contains("<font>")
                        || err.message.contains("href")
                        || err.message.contains("onclick")),
                "{bad}: {}",
                err.message
            );
        }
    }
    #[test]
    fn responsive_images_and_modern_formats_round_trip() {
        // Image chapters commonly use <picture>/<source>/srcset and WebP.
        // Preserving them must not block AI translation.
        let html = "<figure><picture><source srcset=\"images/a.webp\" type=\"image/webp\"/><img src=\"images/a.jpg\" srcset=\"images/a.jpg 1x, images/a@2x.jpg 2x\" sizes=\"100vw\" loading=\"lazy\" decoding=\"async\" alt=\"A\"/></picture><figcaption>Cap</figcaption></figure>";
        let (saved, text) = validate_document(html).expect("responsive images");
        assert!(saved.contains("srcset"), "{saved}");
        assert!(saved.contains("<picture>"), "{saved}");
        assert!(text.contains("[image]"), "{text}");
        // External srcset URLs and misplaced <source> still fail.
        assert!(
            validate_document("<picture><img src=\"https://example.com/a.jpg\"/></picture>")
                .is_err()
        );
        assert!(
            validate_document("<p><source srcset=\"a.jpg\"/></p>").is_err(),
            "source outside picture"
        );
        // WebP/AVIF/BMP data URLs validate by magic bytes.
        let mut webp_bytes = b"RIFF".to_vec();
        webp_bytes.extend_from_slice(&[0, 0, 0, 0]);
        webp_bytes.extend_from_slice(b"WEBP");
        assert!(image_mime_from_bytes(&webp_bytes) == Some("image/webp"));
        assert!(image_mime_from_bytes(b"BMxxxx") == Some("image/bmp"));
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
        let value = value.trim();
        let is_safe_margin = matches!(
            property_name.as_str(),
            "margin" | "margin-top" | "margin-right" | "margin-bottom" | "margin-left"
        ) && is_safe_margin_value(value);
        let is_safe_padding = matches!(
            property_name.as_str(),
            "padding"
                | "padding-top"
                | "padding-right"
                | "padding-bottom"
                | "padding-left"
                | "padding-inline"
                | "padding-inline-start"
                | "padding-inline-end"
                | "padding-block"
                | "padding-block-start"
                | "padding-block-end"
        ) && is_safe_padding_value(value);
        let is_safe_border = is_safe_border_declaration(&property_name, value);
        let is_safe_dimension = matches!(
            property_name.as_str(),
            "width" | "height" | "min-width" | "max-width" | "min-height" | "max-height"
        ) && is_safe_dimension_value(value);
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
        ) && !is_safe_margin
            && !is_safe_padding
            && !is_safe_border
            && !is_safe_dimension
            || property_name == "font-variant-ligatures" && !ligature_value
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

fn is_safe_dimension_value(value: &str) -> bool {
    if value == "auto" {
        return true;
    }
    let number_end = value
        .char_indices()
        .find(|(_, character)| !(character.is_ascii_digit() || *character == '.'))
        .map_or(value.len(), |(index, _)| index);
    if number_end == 0 {
        return false;
    }
    let number = &value[..number_end];
    if number.matches('.').count() > 1
        || number
            .parse::<f32>()
            .ok()
            .is_none_or(|number| !number.is_finite() || number < 0.0)
    {
        return false;
    }
    matches!(
        &value[number_end..],
        "" | "%"
            | "px"
            | "em"
            | "rem"
            | "ex"
            | "ch"
            | "vw"
            | "vh"
            | "pt"
            | "pc"
            | "in"
            | "cm"
            | "mm"
    )
}

/// Margins affect text block spacing, but never allow positioning, functions,
/// URLs, negative offsets, or arbitrary CSS expressions.
fn is_safe_margin_value(value: &str) -> bool {
    let parts = value.split_ascii_whitespace().collect::<Vec<_>>();
    !parts.is_empty()
        && parts.len() <= 4
        && parts.iter().all(|part| {
            if *part == "auto" {
                return true;
            }
            let number_end = part
                .char_indices()
                .find(|(_, character)| !(character.is_ascii_digit() || *character == '.'))
                .map_or(part.len(), |(index, _)| index);
            if number_end == 0 {
                return false;
            }
            let number = &part[..number_end];
            if number.matches('.').count() > 1
                || number
                    .parse::<f32>()
                    .ok()
                    .is_none_or(|number| !number.is_finite())
                || number.starts_with('.') && number.len() == 1
            {
                return false;
            }
            let unit = &part[number_end..];
            matches!(
                unit,
                "" | "%"
                    | "px"
                    | "em"
                    | "rem"
                    | "ex"
                    | "ch"
                    | "vw"
                    | "vh"
                    | "pt"
                    | "pc"
                    | "in"
                    | "cm"
                    | "mm"
            )
        })
}

/// Padding can space text blocks, but unlike margin it cannot use `auto` or
/// negative values. Keep it to one to four plain non-negative lengths.
fn is_safe_padding_value(value: &str) -> bool {
    let parts = value.split_ascii_whitespace().collect::<Vec<_>>();
    !parts.is_empty()
        && parts.len() <= 4
        && parts
            .iter()
            .all(|part| *part != "auto" && is_safe_margin_value(part))
}

fn is_safe_border_declaration(property: &str, value: &str) -> bool {
    let is_border_property = matches!(
        property,
        "border"
            | "border-top"
            | "border-right"
            | "border-bottom"
            | "border-left"
            | "border-width"
            | "border-top-width"
            | "border-right-width"
            | "border-bottom-width"
            | "border-left-width"
            | "border-style"
            | "border-top-style"
            | "border-right-style"
            | "border-bottom-style"
            | "border-left-style"
            | "border-color"
            | "border-top-color"
            | "border-right-color"
            | "border-bottom-color"
            | "border-left-color"
    );
    if !is_border_property {
        return false;
    }

    let parts = value.split_ascii_whitespace().collect::<Vec<_>>();
    if parts.is_empty() || parts.len() > if property == "border" { 3 } else { 4 } {
        return false;
    }
    parts.iter().all(|part| {
        let lower = part.to_ascii_lowercase();
        let style = matches!(
            lower.as_str(),
            "none"
                | "hidden"
                | "dotted"
                | "dashed"
                | "solid"
                | "double"
                | "groove"
                | "ridge"
                | "inset"
                | "outset"
        );
        let numeric_end = part
            .char_indices()
            .find(|(_, character)| !(character.is_ascii_digit() || *character == '.'))
            .map_or(part.len(), |(index, _)| index);
        let length = numeric_end > 0
            && part[..numeric_end]
                .parse::<f32>()
                .is_ok_and(|number| number.is_finite() && number >= 0.0)
            && matches!(
                &part[numeric_end..],
                "" | "px" | "em" | "rem" | "ex" | "ch" | "pt" | "pc" | "in" | "cm" | "mm"
            );
        let hex = part.strip_prefix('#').is_some_and(|digits| {
            matches!(digits.len(), 3 | 4 | 6 | 8)
                && digits
                    .chars()
                    .all(|character| character.is_ascii_hexdigit())
        });
        let named_color = !part.is_empty()
            && part
                .chars()
                .all(|character| character.is_ascii_alphabetic());
        style || length || hex || named_color
    })
}

#[cfg(test)]
mod copied_document_tests {
    use super::*;
    #[test]
    fn common_book_inline_semantics_and_protected_tables_are_export_safe() {
        let input = include_str!("../../../tests/fixtures/editor/book-compatibility.xhtml").trim();
        let (saved, text) = validate_document(input).expect("book formatting");
        assert_eq!(saved, input);
        assert!(text.contains("မြန်မာပုံပြင်"));
        for tag in ["small", "abbr", "cite", "dfn", "kbd", "samp", "var", "mark"] {
            assert!(validate_document(&format!("<{tag}><p>invalid block</p></{tag}>")).is_err());
            assert!(
                validate_document(&format!("<p><{tag} onclick=\"bad()\">text</{tag}></p>"))
                    .is_err()
            );
        }
    }
    #[test]
    fn translated_titlepage_removes_link_target_and_preserves_myanmar() {
        let input = include_str!("../../../tests/fixtures/ai/link-target.xhtml").trim();
        let (html, text) = validate_document(input).expect("translated titlepage");
        assert!(!html.contains("target="));
        assert!(html.contains("href=\"https://example.com/book\""));
        assert!(text.contains("မြန်မာပုံပြင်များ"));
        let (again, _) = validate_document(&html).expect("saved draft");
        assert_eq!(again, html);
        let preview = crate::epub::preview::sanitize_fragment(
            &html,
            "body",
            "chapter.xhtml",
            "epubres://test",
        );
        assert!(!preview.contains("target=\"_top\""));
        assert!(preview.contains("href=\"\""));
        for target in ["_self", "_blank", "_parent", "book-window"] {
            let link =
                format!("<p><a href=\"chapter.xhtml#note\" target=\"{target}\">note</a></p>");
            let (normalized, _) = validate_document(&link).expect("normalized link");
            assert!(!normalized.contains("target="));
            assert!(normalized.contains("chapter.xhtml#note"));
        }
        for bad in [
            "<p target=\"_top\">text</p>",
            "<a href=\"javascript:alert(1)\" target=\"_top\">text</a>",
            "<a href=\"https://example.com\" target=\"_top\" onclick=\"evil()\">text</a>",
        ] {
            assert!(validate_document(bad).is_err(), "{bad}");
        }
    }
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
    fn converts_legacy_paragraph_color_attribute_to_safe_style() {
        let (html, _) =
            validate_document("<p color=\"#336699\" style=\"text-align:center\">Colored text</p>")
                .expect("legacy paragraph color");
        assert!(html.contains("style=\"text-align:center;color:#336699\""));
        assert!(!html.contains(" color="));
        assert!(validate_document("<p color=\"url(javascript:alert(1))\">x</p>").is_err());
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

    #[test]
    fn accepts_safe_margin_spacing_and_rejects_positioning_values() {
        let source = "<p style=\"margin: 0 0 1em; margin-left: 0.5rem\">text</p>";
        let (html, _) = validate_document(source).expect("safe text spacing");
        assert!(html.contains("margin: 0 0 1em"));
        for style in [
            "margin: url(https://example.com)",
            "margin: -10px",
            "margin: 1px; position: fixed",
            "margin: calc(100% - 1px)",
        ] {
            assert!(
                validate_document(&format!("<p style=\"{style}\">x</p>")).is_err(),
                "{style}"
            );
        }
    }

    #[test]
    fn accepts_safe_padding_and_rejects_active_values() {
        let source = "<p style=\"padding: 0.5em 1rem; padding-left: 4px\">စာသား</p>";
        let (html, _) = validate_document(source).expect("safe text padding");
        assert!(html.contains("padding: 0.5em 1rem"));
        for style in [
            "padding: url(https://example.com)",
            "padding: -10px",
            "padding: auto",
            "padding: calc(100% - 1px)",
            "padding: 1em; position: fixed",
        ] {
            assert!(
                validate_document(&format!("<p style=\"{style}\">x</p>")).is_err(),
                "{style}"
            );
        }
    }

    #[test]
    fn accepts_safe_inline_borders_and_rejects_active_values() {
        let source =
            "<p style=\"border: 1px solid #333; border-bottom: 0.5em dotted black\">text</p>";
        let (html, _) = validate_document(source).expect("safe border styles");
        assert!(html.contains("border: 1px solid #333"));
        for style in [
            "border: url(https://example.com)",
            "border: 1px solid; position: fixed",
            "border: expression(alert(1))",
            "border: -2px solid red",
        ] {
            assert!(
                validate_document(&format!("<p style=\"{style}\">x</p>")).is_err(),
                "{style}"
            );
        }
    }

    #[test]
    fn accepts_safe_inline_dimensions_and_rejects_expressions() {
        let source = "<p style=\"height: 12em; width: 100%; max-height: 480px\">text</p>";
        let (html, _) = validate_document(source).expect("safe dimensions");
        assert!(html.contains("height: 12em"));
        for style in [
            "height: url(https://example.com)",
            "height: -10px",
            "height: calc(100% - 1px)",
            "position: fixed; height: 100vh",
        ] {
            assert!(
                validate_document(&format!("<p style=\"{style}\">x</p>")).is_err(),
                "{style}"
            );
        }
    }
}

#[cfg(test)]
mod original_cover_tests {
    use super::*;
    #[test]
    fn accepts_ebookmaker_cover_div_svg_and_relative_image() {
        let input = "<div class=\"x-ebookmaker-cover\"><svg xmlns=\"http://www.w3.org/2000/svg\" height=\"100%\" preserveAspectRatio=\"xMidYMid meet\" version=\"1.1\" viewBox=\"0 0 800 1104\" width=\"100%\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><image width=\"800\" height=\"1104\" xlink:href=\"7981341119032183217_cover.jpg\"/></svg></div>";
        let (html, text) = validate_document(input).expect("original cover");
        assert!(html.contains("x-ebookmaker-cover"), "{html}");
        assert!(html.contains("<svg"), "{html}");
        assert!(html.contains("7981341119032183217_cover.jpg"), "{html}");
        // Image-only covers still count as content so they can be reviewed.
        assert!(html.contains("<image"), "{html}");
        assert!(!text.trim().is_empty() || html.contains("image"), "{text}");
        assert!(text.contains("[image]"), "{text}");
        // The stored fragment must re-parse as XML for export splicing.
        let wrapped = format!("<w>{html}</w>");
        crate::epub::xml::parse(&wrapped).expect("export-safe xml");
    }
    #[test]
    fn accepts_svg_href_form_and_relative_img_and_original_inline() {
        let (html, _) = validate_document(
            "<div><svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\"><image href=\"images/cover.png\" width=\"10\" height=\"10\"/></svg></div>",
        )
        .expect("svg href");
        assert!(html.contains("images/cover.png"), "{html}");
        let (html, _) = validate_document("<p>Text <img src=\"images/a.png\" alt=\"A\"/> tail</p>")
            .expect("relative img");
        assert!(html.contains("src=\"images/a.png\""), "{html}");
        let (html, _) = validate_document(
            "<section class=\"ch\"><div><p>Hi <span class=\"s\"><b>bold</b> and <i>it</i></span></p><figure><img src=\"i.png\" alt=\"I\"/><figcaption>Cap <sup>1</sup></figcaption></figure></div></section>",
        )
        .expect("original structure");
        assert!(html.contains("<section"), "{html}");
        assert!(html.contains("<figure"), "{html}");
        assert!(html.contains("<figcaption>"), "{html}");
    }
    #[test]
    fn removes_only_empty_breaks_inserted_inside_svg() {
        let (html, _) = validate_document(
            "<div><svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\"><path d=\"M0 0\"/><br/><circle r=\"2\"/></svg></div>",
        )
        .expect("ignore an invalid SVG break");
        assert!(html.contains("<path d=\"M0 0\"/>"), "{html}");
        assert!(html.contains("<circle r=\"2\"/>"), "{html}");
        assert!(!html.contains("<br"), "{html}");
        // Ordinary XHTML breaks remain valid and preserved.
        let (html, _) = validate_document("<p>one<br/>two</p>").expect("XHTML break");
        assert!(html.contains("<br/>"), "{html}");
    }
    #[test]
    fn still_rejects_external_and_active_svg_content() {
        for html in [
            "<div><svg xmlns=\"http://www.w3.org/2000/svg\"><image href=\"https://example.com/a.png\"/></svg></div>",
            "<div><svg xmlns=\"http://www.w3.org/2000/svg\" onload=\"evil()\"><image href=\"a.png\"/></svg></div>",
            "<div><svg xmlns=\"http://www.w3.org/2000/svg\"><script>evil()</script></svg></div>",
            "<div><svg xmlns=\"http://www.w3.org/2000/svg\"><foreignObject><div>bad</div></foreignObject></svg></div>",
            "<p><svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"></svg></p>",
        ] {
            assert!(validate_document(html).is_err(), "{html}");
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
    fn preserves_safe_table_column_groups_and_rejects_invalid_positions() {
        let html = "<table><colgroup span=\"2\"><col width=\"50%\"/><col style=\"width:25%\"/></colgroup><tbody><tr><td>A</td><td>B</td></tr></tbody></table>";
        let (saved, _) = validate_document(html).expect("column group");
        assert_eq!(saved, html);
        for invalid in [
            "<table><col/></table>",
            "<table><colgroup><tr><td>x</td></tr></colgroup></table>",
            "<table><colgroup span=\"101\"><col/></colgroup><tbody><tr><td>x</td></tr></tbody></table>",
        ] {
            assert!(validate_document(invalid).is_err(), "{invalid}");
        }
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
