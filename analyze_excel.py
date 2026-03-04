import pandas as pd
import json

try:
    file_path = "D:/00_A_PAUSER/web_tareo/web_tareo/excel/1. OK TAREO 2601 - PAUSER DISTRIBUCIONES SAC (3).xlsx"
    sheet_name = '2601'
    df = pd.read_excel(file_path, sheet_name=sheet_name, header=None, nrows=20)
    
    header_row = df.iloc[13] # Excel row 14
    cols = {}
    for j, val in enumerate(header_row):
        if pd.notna(val):
            cols[str(j)] = str(val).strip()
            
    with open('columns.json', 'w', encoding='utf-8') as f:
        json.dump(cols, f, indent=2, ensure_ascii=False)
        
except Exception as e:
    print(f"Error: {str(e)}")
