//! Accept inert HTML5 and standard XHTML 1.1 doctypes. Never load an external
//! DTD or accept internal entity declarations; roxmltree has no resolver here.
pub(crate) fn parse(text: &str) -> Result<roxmltree::Document<'_>, roxmltree::Error> {
    let mut reader = quick_xml::Reader::from_str(text);
    let mut allow_dtd = false;
    loop {
        match reader.read_event() {
            Ok(quick_xml::events::Event::DocType(value)) => {
                if allow_dtd {
                    return Err(roxmltree::Error::DtdDetected);
                }
                let declaration = value
                    .as_ref()
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ");
                if declaration
                    != r#"ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd""#
                    && declaration
                        != "ncx PUBLIC '-//NISO//DTD ncx 2005-1//EN' 'http://www.daisy.org/z3986/2005/ncx-2005-1.dtd'"
                    && declaration != "html"
                    && declaration
                        != r#"html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd""#
                    && declaration
                        != "html PUBLIC '-//W3C//DTD XHTML 1.1//EN' 'http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd'"
                {
                    return Err(roxmltree::Error::DtdDetected);
                }
                allow_dtd = true;
            }
            Ok(
                quick_xml::events::Event::Start(_)
                | quick_xml::events::Event::Empty(_)
                | quick_xml::events::Event::Eof,
            )
            | Err(_) => break,
            _ => {}
        }
    }
    roxmltree::Document::parse_with_options(
        text,
        roxmltree::ParsingOptions {
            allow_dtd,
            ..Default::default()
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_html_doctype_but_rejects_entities_and_external_dtds() {
        assert!(parse("<!DOCTYPE html><html/>").is_ok());
        assert!(parse("<!DOCTYPE html [<!ENTITY x 'expanded'>]><html>&x;</html>").is_err());
        assert!(parse("<!DOCTYPE html SYSTEM 'https://example.com/a.dtd'><html/>").is_err());
    }

    #[test]
    fn accepts_inert_xhtml11_declaration_without_resolving_entities() {
        let declaration = r#"<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">"#;
        assert!(
            parse(&format!(
                "{declaration}<html><p>Text &#x2019; မြန်မာ</p></html>"
            ))
            .is_ok()
        );
        assert!(parse(&format!("{declaration}<html>&nbsp;</html>")).is_err());
        assert!(parse(r#"<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd" [<!ENTITY x 'unsafe'>]><html>&x;</html>"#).is_err());
    }
}
