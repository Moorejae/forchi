# Temp: extract text from the base resume PDF to see the real experience section.
import pypdf, sys

path = r"c:\Users\hp\forchi\data\resume\Agu_Victor_Chiedozie_Resum.pdf"
try:
    r = pypdf.PdfReader(path)
    print("pages:", len(r.pages))
    for i, p in enumerate(r.pages):
        t = p.extract_text() or ""
        print(f"\n===== PAGE {i+1} =====")
        print(t)
except Exception as e:
    print("ERR:", e)
