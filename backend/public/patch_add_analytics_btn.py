import re

# ── CONFIG ──────────────────────────────────────────────────────
INPUT_FILE  = r'C:\Deemona_Finance_Backend\deemona-backend\public\index.html'
OUTPUT_FILE = r'C:\Deemona_Finance_Backend\deemona-backend\public\index.html'
# ────────────────────────────────────────────────────────────────

ANALYTICS_BUTTON = (
    '<a href="analytics.html" '
    'style="display:inline-flex;align-items:center;gap:6px;padding:5px 13px;'
    'border-radius:8px;background:rgba(16,185,129,.1);'
    'border:1px solid rgba(16,185,129,.22);color:#10b981;font-size:11px;'
    'font-weight:600;text-decoration:none;letter-spacing:.3px;transition:all .2s" '
    'onmouseover="this.style.background=\'rgba(16,185,129,.2)\';this.style.borderColor=\'rgba(16,185,129,.4)\'" '
    'onmouseout="this.style.background=\'rgba(16,185,129,.1)\';this.style.borderColor=\'rgba(16,185,129,.22)\'">📊 Analytics</a>'
)

# The exact string to find — right before ageTxt
TARGET = '<span class="age-txt" id="ageTxt">Refresh: 0s ago</span>'

with open(INPUT_FILE, 'r', encoding='utf-8') as f:
    content = f.read()

if TARGET not in content:
    print("ERROR: Could not find the target location in index.html")
    print("Make sure you're pointing to the right file.")
    exit(1)

# Insert Analytics button right before ageTxt span
modified = content.replace(TARGET, ANALYTICS_BUTTON + TARGET, 1)

with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
    f.write(modified)

print("SUCCESS: Analytics button added to index.html")
print(f"File saved: {OUTPUT_FILE}")
print()
print("Now run:")
print("  git add public/index.html")
print("  git commit -m 'Add Analytics button to dashboard header'")
print("  git push origin main")
