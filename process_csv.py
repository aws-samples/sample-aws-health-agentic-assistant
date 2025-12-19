import pandas as pd
import requests
from bs4 import BeautifulSoup
import time

def extract_description_resolution(url):
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Look for Description and Resolution fields
        description = ""
        resolution = ""
        
        # Try common patterns for STIG viewer
        desc_elem = soup.find(text=lambda text: text and 'Description' in text)
        if desc_elem:
            desc_parent = desc_elem.parent
            if desc_parent:
                next_elem = desc_parent.find_next()
                if next_elem:
                    description = next_elem.get_text(strip=True)
        
        res_elem = soup.find(text=lambda text: text and 'Resolution' in text)
        if res_elem:
            res_parent = res_elem.parent
            if res_parent:
                next_elem = res_parent.find_next()
                if next_elem:
                    resolution = next_elem.get_text(strip=True)
        
        return description, resolution
    except Exception as e:
        print(f"Error processing {url}: {e}")
        return "", ""

# Read CSV file
csv_path = "/Temp1/SpecReq_Table_export.csv"
df = pd.read_csv(csv_path)

# Find the column with links (assuming it contains 'http' or 'www')
link_column = None
for col in df.columns:
    if df[col].astype(str).str.contains('http|www', na=False).any():
        link_column = col
        break

if not link_column:
    print("No link column found")
    exit()

# Add new columns
df['Description'] = ""
df['Resolution'] = ""

# Process each row
for index, row in df.iterrows():
    url = row[link_column]
    if pd.notna(url) and str(url).startswith('http'):
        print(f"Processing row {index + 1}: {url}")
        description, resolution = extract_description_resolution(url)
        df.at[index, 'Description'] = description
        df.at[index, 'Resolution'] = resolution
        time.sleep(1)  # Be respectful to the server

# Save updated file
output_path = "/Temp1/SpecReq_Table_export_updated.csv"
df.to_csv(output_path, index=False)
print(f"Updated file saved to: {output_path}")
