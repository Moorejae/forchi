# Extract text from lookhere.docx (it's a zip with word/document.xml)
import zipfile, re, sys

path = r"C:\Users\hp\Downloads\lookhere.docx"
try:
    z = zipfile.ZipFile(path)
    xml = z.read("word/document.xml").decode("utf-8", errors="replace")
except Exception as e:
    print("ERR reading docx:", e)
    sys.exit(1)

# Paragraphs = <w:p>...</w:p>; runs = <w:t>...</w:t>
paras = re.findall(r"<w:p[ >].*?</w:p>", xml, re.S)
out = []
for p in paras:
    texts = re.findall(r"<w:t[^>]*>(.*?)</w:t>", p, re.S)
    line = "".join(texts)
    line = line.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    out.append(line)

print("=== FULL DOCX TEXT ===")
print("\n".join(out))
