from pathlib import Path
import re
import urllib.request

output = Path(__file__).resolve().parent.parent / "public" / "fonts"
output.mkdir(parents=True, exist_ok=True)
agent = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"

def fetch(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": agent}), timeout=30).read()

families = [
    ("ibm-plex-sans", "IBM+Plex+Sans:wght@400;500;600;700", ""),
    ("ibm-plex-mono", "IBM+Plex+Mono:wght@400;500;600", ""),
]
css = []
for name, family, extra in families:
    stylesheet = fetch("https://fonts.googleapis.com/css2?family=" + family + extra + "&display=swap").decode()
    blocks = re.findall(r"@font-face\s*\{[^}]+\}", stylesheet)
    blocks = [block for block in blocks if "U+0000-00FF" in block or "unicode-range" not in block]
    urls = {}
    for block in blocks:
        url = re.search(r"url\(([^)]+)\)", block).group(1)
        if url not in urls:
            extension = "woff2" if "woff2" in block else "ttf"
            filename = f"{name}-{len(urls)}.{extension}"
            (output / filename).write_bytes(fetch(url))
            urls[url] = filename
        css.append(block.replace(url, "/fonts/" + urls[url]))
(output / "fonts.css").write_text("\n".join(css) + "\n")
print("Local fonts:", [file.name for file in output.iterdir()])
