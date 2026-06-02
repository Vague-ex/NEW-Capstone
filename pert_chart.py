"""PERT-CPM diagram generator for Graduate Tracer System schedule."""
from collections import defaultdict
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
from matplotlib.lines import Line2D

# (id, name, predecessors, ET (expected duration in days))
ACTIVITIES = [
    ("A", "Project Validation\n& MOA Signing",            [],            6),
    ("B", "Requirement\nGathering",                       ["A"],         8),
    ("C", "Literature\nReview",                           ["A"],         8),
    ("D", "Feasibility Study\n& Risk Assessment",         ["B","C"],     15),
    ("E", "System\nAnalysis",                             ["D"],         8),
    ("F", "System Arch. &\nDatabase Schema",              ["E"],         8),
    ("G", "UI/UX Wireframes\n(Figma)",                    ["E"],         8),
    ("H", "Project\nFinalization",                        ["F","G"],     9),
    ("I", "Choose\nProgramming Tools",                    ["H"],         4),
    ("J", "Graduate Registration\n& Verification",        ["I"],         29),
    ("K", "Biometric\nVerification",                      ["J"],         37),
    ("L", "Graduate Profile &\nEmployment Monitoring",    ["J"],         33),
    ("M", "Employer\nInteraction Module",                 ["L"],         29),
    ("N", "Geographic Distribution\n& Mapping",           ["L"],         22),
    ("O", "Predictive Employability\nTrend Analysis",     ["M"],         37),
    ("P", "Administrative\nDashboard Module",             ["O","K","N"], 29),
    ("Q", "Reporting &\nDocumentation Module",            ["P"],         15),
    ("R", "Test for\nErrors",                             ["Q"],         22),
    ("S", "User\nTesting",                                ["R"],         15),
    ("T", "Present to\nBeneficiary",                      ["S"],         8),
    ("U", "System\nImprovement",                          ["T"],         8),
    ("V", "Deployment",                                   ["U"],         1),
]

by_id = {a[0]: a for a in ACTIVITIES}

# ---- Forward pass ----
ES, EF = {}, {}
for aid, _, preds, dur in ACTIVITIES:
    ES[aid] = max([EF[p] for p in preds], default=0)
    EF[aid] = ES[aid] + dur
PROJECT_DUR = max(EF.values())

# ---- Backward pass ----
succs = defaultdict(list)
for aid, _, preds, _ in ACTIVITIES:
    for p in preds:
        succs[p].append(aid)
LS, LF = {}, {}
for aid, _, _, dur in reversed(ACTIVITIES):
    LF[aid] = min([LS[s] for s in succs[aid]], default=PROJECT_DUR)
    LS[aid] = LF[aid] - dur
SLACK = {aid: LS[aid] - ES[aid] for aid in ES}
CRITICAL = {aid for aid, s in SLACK.items() if s == 0}

# ---- Layout: snake rows ----
depth = {}
for aid, _, preds, _ in ACTIVITIES:
    depth[aid] = 0 if not preds else max(depth[p] for p in preds) + 1
cols = defaultdict(list)
for aid in depth:
    cols[depth[aid]].append(aid)

sorted_depths = sorted(cols.keys())                # 0 .. 17
ROWS = 3
per_row = (len(sorted_depths) + ROWS - 1) // ROWS  # 6
COL_W = 5.0
ROW_H = 8.0
BOX_W = 4.2
BOX_H = 3.6
PARALLEL_GAP = BOX_H + 0.6                         # vertical gap between B/C, F/G, K/L, M/N

pos = {}
for r in range(ROWS):
    row_depths = sorted_depths[r*per_row:(r+1)*per_row]
    if r % 2 == 1:
        row_depths = list(reversed(row_depths))
    for i, d in enumerate(row_depths):
        x = i * COL_W
        y = -r * ROW_H
        col_aids = cols[d]
        for j, aid in enumerate(col_aids):
            offset = (j - (len(col_aids)-1)/2) * PARALLEL_GAP
            pos[aid] = (x, y + offset)

# ---- Draw ----
W = per_row * COL_W
fig, ax = plt.subplots(figsize=(28, 18))
ax.set_xlim(-1.5, W + 0.5)
ax.set_ylim(-(ROWS) * ROW_H - 2, 8.5)
ax.set_aspect("equal")
ax.axis("off")

def draw_node(aid):
    x, y = pos[aid]
    _, name, _, dur = by_id[aid]
    is_crit = aid in CRITICAL
    face = "#ffe0e0" if is_crit else "#e6f0fb"
    edge = "#b81d1d" if is_crit else "#1f4e8a"
    txt  = "#7b1818" if is_crit else "#0c2a52"

    # outer rounded box
    box = FancyBboxPatch((x - BOX_W/2, y - BOX_H/2), BOX_W, BOX_H,
                         boxstyle="round,pad=0.02,rounding_size=0.15",
                         linewidth=2.4, edgecolor=edge, facecolor=face, zorder=2)
    ax.add_patch(box)

    # horizontal dividers
    top_div = y + BOX_H/2 - 1.0
    bot_div = y - BOX_H/2 + 1.0
    ax.plot([x - BOX_W/2, x + BOX_W/2], [top_div, top_div], color=edge, lw=1.0, zorder=3)
    ax.plot([x - BOX_W/2, x + BOX_W/2], [bot_div, bot_div], color=edge, lw=1.0, zorder=3)

    third = BOX_W / 3
    # vertical separators in top & bottom rows only
    for sx in (x - third/2, x + third/2):
        ax.plot([sx, sx], [top_div, y + BOX_H/2], color=edge, lw=1.0, zorder=3)
        ax.plot([sx, sx], [y - BOX_H/2, bot_div], color=edge, lw=1.0, zorder=3)

    # top row: ES | DUR | EF
    top_y = (top_div + y + BOX_H/2) / 2
    ax.text(x - third, top_y + 0.16, "ES", ha="center", va="center", fontsize=8, color=txt)
    ax.text(x - third, top_y - 0.18, f"{ES[aid]}", ha="center", va="center", fontsize=11, fontweight="bold", color=txt)
    ax.text(x,         top_y + 0.16, "DUR", ha="center", va="center", fontsize=8, color=txt)
    ax.text(x,         top_y - 0.18, f"{dur}", ha="center", va="center", fontsize=11, fontweight="bold", color=txt)
    ax.text(x + third, top_y + 0.16, "EF", ha="center", va="center", fontsize=8, color=txt)
    ax.text(x + third, top_y - 0.18, f"{EF[aid]}", ha="center", va="center", fontsize=11, fontweight="bold", color=txt)

    # middle: big ID + activity name
    ax.text(x, y + 0.35, aid, ha="center", va="center", fontsize=22, fontweight="bold", color=txt)
    ax.text(x, y - 0.45, name, ha="center", va="center", fontsize=7.5, color=txt)

    # bottom row: LS | SLACK | LF
    bot_y = (bot_div + y - BOX_H/2) / 2
    ax.text(x - third, bot_y + 0.16, "LS", ha="center", va="center", fontsize=8, color=txt)
    ax.text(x - third, bot_y - 0.18, f"{LS[aid]}", ha="center", va="center", fontsize=11, fontweight="bold", color=txt)
    ax.text(x,         bot_y + 0.16, "SLACK", ha="center", va="center", fontsize=8, color=txt)
    ax.text(x,         bot_y - 0.18, f"{SLACK[aid]}", ha="center", va="center", fontsize=11, fontweight="bold", color=txt)
    ax.text(x + third, bot_y + 0.16, "LF", ha="center", va="center", fontsize=8, color=txt)
    ax.text(x + third, bot_y - 0.18, f"{LF[aid]}", ha="center", va="center", fontsize=11, fontweight="bold", color=txt)


def edge_point(cx, cy, tx, ty):
    """Where a line from (cx,cy) toward (tx,ty) hits the box boundary."""
    dx, dy = tx - cx, ty - cy
    if dx == 0 and dy == 0:
        return cx, cy
    # scale so |dx|<=BOX_W/2 or |dy|<=BOX_H/2 at boundary
    sx = (BOX_W/2) / abs(dx) if dx != 0 else float("inf")
    sy = (BOX_H/2) / abs(dy) if dy != 0 else float("inf")
    s = min(sx, sy)
    return cx + dx * s, cy + dy * s


def draw_arrow(src, dst):
    x1, y1 = pos[src]
    x2, y2 = pos[dst]
    is_crit = (src in CRITICAL) and (dst in CRITICAL)
    color = "#b81d1d" if is_crit else "#5b6470"
    lw = 2.4 if is_crit else 1.2

    sx, sy = edge_point(x1, y1, x2, y2)
    ex, ey = edge_point(x2, y2, x1, y1)

    arrow = FancyArrowPatch((sx, sy), (ex, ey),
                            arrowstyle="-|>", mutation_scale=18,
                            color=color, lw=lw,
                            connectionstyle="arc3,rad=0", zorder=1)
    ax.add_patch(arrow)


# arrows behind nodes
for aid, _, preds, _ in ACTIVITIES:
    for p in preds:
        draw_arrow(p, aid)
for aid in by_id:
    draw_node(aid)

# ---- Title ----
ax.text(W/2, 7.5,
        "PERT - CPM Network Diagram",
        ha="center", va="center", fontsize=28, fontweight="bold", color="#0c2a52")
ax.text(W/2, 6.0,
        f"Graduate Tracer System   |   Project Duration: {PROJECT_DUR} days   |   "
        f"Critical Path shown in RED",
        ha="center", va="center", fontsize=14, color="#444")

# legend
legend_elems = [
    Line2D([0],[0], marker='s', color='w', markerfacecolor='#ffe0e0',
           markeredgecolor='#b81d1d', markersize=16, label='Critical activity (slack = 0)'),
    Line2D([0],[0], marker='s', color='w', markerfacecolor='#e6f0fb',
           markeredgecolor='#1f4e8a', markersize=16, label='Non-critical activity'),
    Line2D([0],[0], color='#b81d1d', lw=2.4, label='Critical path'),
    Line2D([0],[0], color='#5b6470', lw=1.2, label='Dependency'),
]
ax.legend(handles=legend_elems, loc='lower right', fontsize=11,
          frameon=True, facecolor='white', edgecolor='#999')

# node-key legend (separate small box in lower-left)
key_x = -0.5
key_y = -ROWS * ROW_H + 2.5
kbw, kbh = 3.4, 3.0
key_box = FancyBboxPatch((key_x, key_y - kbh/2), kbw, kbh,
                         boxstyle="round,pad=0.02,rounding_size=0.1",
                         linewidth=1.2, edgecolor="#0c2a52", facecolor="#fafafa")
ax.add_patch(key_box)
ax.text(key_x + kbw/2, key_y + kbh/2 - 0.3, "Node Key",
        fontsize=11, fontweight="bold", color="#0c2a52", ha="center")
key_lines = [
    "Top row:    ES   |   DUR   |   EF",
    "Middle:        ID  +  Activity name",
    "Bottom row: LS   |  SLACK  |   LF",
]
for i, line in enumerate(key_lines):
    ax.text(key_x + 0.2, key_y + 0.4 - i*0.55, line, fontsize=9, color="#0c2a52")

out_path = r"C:\Users\Lenovo\OneDrive\Desktop\NEW-Capstone\pert_chart.png"
plt.tight_layout()
plt.savefig(out_path, dpi=200, bbox_inches="tight", facecolor="white")
print(f"Saved: {out_path}")
print(f"Project duration: {PROJECT_DUR} days")
print(f"Critical activities ({len(CRITICAL)}): {sorted(CRITICAL)}")
non_crit = sorted(set(by_id) - CRITICAL)
print(f"Non-critical ({len(non_crit)}): {non_crit}")
for aid in sorted(by_id):
    print(f"  {aid}: ES={ES[aid]:3d}  EF={EF[aid]:3d}  LS={LS[aid]:3d}  LF={LF[aid]:3d}  SLACK={SLACK[aid]:3d}  {'CRIT' if aid in CRITICAL else ''}")
