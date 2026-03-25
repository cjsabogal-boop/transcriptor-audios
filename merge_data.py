import json

# Original high-quality data for 1-7
original_data = [
    {"chapter": 1, "title": "Hechos 1 - El Comienzo del Avance del Evangelio", "category": "Jerusalén"},
    {"chapter": 2, "title": "Hechos 2 - El Derramamiento del Espíritu Santo", "category": "Jerusalén"},
    {"chapter": 3, "title": "Hechos 3 - Sanidad de un Cojo y Predicación de Pedro", "category": "Jerusalén"},
    {"chapter": 4, "title": "Hechos 4 - Oposición y Valentía", "category": "Jerusalén"},
    {"chapter": 5, "title": "Hechos 5 - Disciplina y Avance", "category": "Jerusalén"},
    {"chapter": 6, "title": "Hechos 6 - Elección de Diáconos y Esteban", "category": "Jerusalén"},
    {"chapter": 7, "title": "Hechos 7 - El Discurso y Martirio de Esteban", "category": "Jerusalén"}
]

# (Omitting full original content for brevity in the script, but I'll use the existing file for reference)
# Actually, I'll rewrite the whole src/data.js manually because I have the contents.

def get_category(ch):
    if 1 <= ch <= 7: return "Jerusalén"
    if 8 <= ch <= 12: return "Judea y Samaria"
    return "Hasta lo último"

# Load current data.js content (I already have it from view_file)
# Wait, I'll just use the JSON I have.

with open("full_studies_data.json", "r", encoding='utf-8') as f:
    extracted_data = json.load(f)

# Re-merge but with categories
final_data = []

# Map of original titles/objectives for 1-7 to preserve high quality
original_full = {
    1: {"title": "Hechos 1 - El Comienzo del Avance del Evangelio", "objective": "Aprender cómo Jesús preparó a sus discípulos después de su resurrección..."},
    # ... (I'll just trust the extraction for now or manually refine Chapter 1-7 if they look bad)
}

for item in extracted_data:
    ch = item["chapter"]
    item["category"] = get_category(ch)
    item["spotifyTrackId"] = ""
    # Ensure properties exist
    if "centralIdea" not in item: item["centralIdea"] = ""
    if "keyVerse" not in item: item["keyVerse"] = ""
    
    if ch > 10:
        item["image"] = "/assets/hero.png"
    else:
        item["image"] = f"/assets/ch{ch}.png"
    
    # Clean up titles
    item["title"] = item["title"].replace(" – Método COMA", "").replace(" — Estudio del Evangelio con el Sistema COMA", "").replace(":", "")
    
    final_data.append(item)

# Write as JS
output = "export const categories = [\n  { id: 'jerusalen', name: 'Testigos en Jerusalén', range: [1, 7] },\n  { id: 'judea', name: 'Testigos en Judea y Samaria', range: [8, 12] },\n  { id: 'tierra', name: 'Testigos hasta lo último', range: [13, 28] }\n];\n\n"
output += "export const studiesData = " + json.dumps(final_data, indent=2, ensure_ascii=False) + ";"
with open("src/data.js", "w", encoding='utf-8') as f:
    f.write(output)
