from pathlib import Path
import re
import urllib.parse
import urllib.request

output = Path(__file__).resolve().parent.parent / "public" / "fonts"
output.mkdir(parents=True, exist_ok=True)
icons = "add_photo_alternate code add_link add_to_home_screen android apps arrow_back arrow_back_ios_new arrow_downward arrow_forward arrow_upward bedtime bluetooth_searching calculate call camera_alt cancel chat check check_circle chevron_left chevron_right circle close cloud_off contrast crop_square dark_mode delete devices dns download draft drive_folder_upload edit_note error expand_less expand_more filter_none folder folder_off folder_open hd help high_quality home hub image info instant_mix keyboard keyboard_hide light_mode link mail menu more_horiz movie music_note notifications pause phone_android phonelink_off photo_camera photo_library play_arrow play_circle play_pause power_settings_new progress_activity public refresh remove restart_alt save screen_rotation screenshot_monitor search search_off send settings skip_next skip_previous smartphone speed star stop stop_circle sync sync_problem touch_app tune upload upload_file usb view_carousel visibility volume_down volume_off volume_up warning wb_sunny wifi wifi_tethering".split()
agent = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"

def fetch(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": agent}), timeout=30).read()

families = [
    ("material-symbols-rounded", "Material+Symbols+Rounded", "&icon_names=" + ",".join(sorted(set(icons)))),
    ("ibm-plex-sans", "IBM+Plex+Sans:wght@400;500;600;700", ""),
    ("ibm-plex-mono", "IBM+Plex+Mono:wght@400;500;600", ""),
]
css = []
for name, family, extra in families:
    stylesheet = fetch("https://fonts.googleapis.com/css2?family=" + family + extra + "&display=swap").decode()
    blocks = re.findall(r"@font-face\s*\{[^}]+\}", stylesheet)
    if name != "material-symbols-rounded":
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
