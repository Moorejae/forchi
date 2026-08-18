# Temp: extract text from the persona blueprint docx (stdlib only).
import zipfile, re, sys

DOCX = r"C:\Users\hp\Downloads\Victor Moore Linguistics & Psychological Persona Blueprint V2.docx"
OUT = r"c:\Users\hp\forchi\temp_media\persona_blueprint.txt"

with zipfile.ZipFile(DOCX) as z:
    xml = z.read("word/document.xml").decode("utf-8", errors="ignore")

# paragraphs
xml = xml.replace("</w:p>", "\n")
# tabs
xml = xml.replace("<w:tab/>", "\t")
# strip all remaining tags
text = re.sub(r"<[^>]+>", "", xml)
# unescape common entities
text = (text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
            .replace("&quot;", '"').replace("&apos;", "'"))
# collapse blank lines
lines = [l.rstrip() for l in text.splitlines()]
out = "\n".join(l for l in lines if l.strip() or l == "")
with open(OUT, "w", encoding="utf-8") as f:
    f.write(out)

print("chars:", len(out))
print("lines:", len([l for l in out.splitlines() if l.strip()]))
