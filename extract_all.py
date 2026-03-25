
import zipfile
import xml.etree.ElementTree as ET
import os
import json
import re

def get_docx_text(path):
    try:
        document = zipfile.ZipFile(path)
        xml_content = document.read('word/document.xml')
        document.close()
        tree = ET.fromstring(xml_content)
        ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
        paragraphs = []
        for paragraph in tree.findall('.//w:p', ns):
            texts = [node.text for node in paragraph.findall('.//w:t', ns) if node.text]
            if texts:
                paragraphs.append("".join(texts))
        return "\n".join(paragraphs)
    except:
        return ""

def parse_docx_content(text, ch_num):
    data = {
        "chapter": ch_num,
        "title": f"Hechos {ch_num}",
        "objective": "",
        "context": {"items": []},
        "observation": {"items": []},
        "meaning": {"items": []},
        "application": {"items": []},
        "gospel": {"items": []},
        "keyVerse": "",
        "centralIdea": "",
        "image": f"/assets/ch{ch_num}.png"
    }

    # Extract Title and Objective from the beginning
    lines = text.split('\n')
    found_objective = False
    for i, line in enumerate(lines):
        line = line.strip()
        if not line: continue
        if "MÉTODO COMA" in line.upper():
            data["title"] = line
        elif "OBJETIVO" in line.upper():
            if ":" in line:
                data["objective"] = line.split(":", 1)[1].strip()
            found_objective = True
        elif found_objective and not data["objective"]:
            data["objective"] = line
            found_objective = False
        
        if "1. CONTEXTO" in line.upper():
            break

    # Split into sections by the main "X. " pattern
    sections = re.split(r'\n\s*\d+\.\s*', text)
    
    for sec in sections:
        sec = sec.strip()
        if not sec: continue
        lines = sec.split('\n')
        header = lines[0].upper()
        content_lines = lines[1:]
        
        target_list = None
        if "CONTEXTO" in header: target_list = data["context"]["items"]
        elif "OBSERVACIÓN" in header: target_list = data["observation"]["items"]
        elif "SIGNIFICADO" in header: target_list = data["meaning"]["items"]
        elif "APLICACIÓN" in header: target_list = data["application"]["items"]
        elif "EVANGELIO" in header: target_list = data["gospel"]["items"]
        elif "RESULTADO" in header: target_list = data["gospel"]["items"]
        
        if target_list is not None:
            for line in content_lines:
                line = line.strip()
                if not line: continue
                # Identify if it's a verse reference or instruction
                item = {
                    "text": line,
                    "isQuestion": "?" in line or "Completa:" in line or "____" in line
                }
                target_list.append(item)

    # More flexible regex for the memory verse and central idea
    # Find all potential blocks at the end to be very robust
    kv_pattern = r'(?:\d+\.\s*)?(?:Vers\u00edculo clave|Memorice|Memorizar|PARA RECORDAR)[^\n]*\n+(.*?)(?=\n\s*\d+\.|$)'
    kv_match = re.search(kv_pattern, text, re.I | re.DOTALL)
    if kv_match:
        data["keyVerse"] = kv_match.group(1).strip()
    
    ci_pattern = r'(?:\d+\.\s*)?(?:Idea central|Resumen central|Resumen)[^\n]*\n+(.*?)(?=\n\s*\d+\.|$)'
    ci_match = re.search(ci_pattern, text, re.I | re.DOTALL)
    if ci_match:
        data["centralIdea"] = ci_match.group(1).strip()
    elif "El evangelio en Hechos" in text:
        # Fallback for "El evangelio en Hechos X" style
        ev_match = re.search(r'El evangelio en Hechos \d+\s*\n+(.*?)(?=\n\s*\d+\.|$)', text, re.I | re.DOTALL)
        if ev_match:
            data["centralIdea"] = ev_match.group(1).strip()

    return data

def main():
    folder = "hojasdetrabajobiblicodehechosdelosapstoles_"
    files = [f for f in os.listdir(folder) if f.endswith(".docx")]
    all_data = []

    parsed_files = []
    for f in files:
        m = re.search(r'Hechos\s*(\d+)', f, re.I)
        if m:
            parsed_files.append((int(m.group(1)), f))
    
    parsed_files.sort()

    for ch_num, filename in parsed_files:
        path = os.path.join(folder, filename)
        print(f"Processing Chapter {ch_num} ({filename})...")
        text = get_docx_text(path)
        ch_data = parse_docx_content(text, ch_num)
        all_data.append(ch_data)

    with open("full_studies_data.json", "w", encoding="utf-8") as f:
        json.dump(all_data, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    main()
