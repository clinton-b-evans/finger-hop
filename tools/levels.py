"""Authoring tool (not needed at runtime): builds + validates levels/levels.json.
Run: python3 tools/levels.py levels/levels.json
Paths are written as moves:
R = col+1 (down-right on screen), L = col-1, D = row+1 (down-left), U = row-1."""
import json, sys
from collections import deque

MOVES = {'R': (0, 1), 'L': (0, -1), 'D': (1, 0), 'U': (-1, 0)}
TILE_KEY = {"G": "tile_grass", "S": "tile_sand", "W": "tile_water", "B": "tile_bridge",
            "T": "tile_stone", "N": "tile_number", ".": None}

def L(id, name, world, moves, codes, goal_item='star', berries=(), maxHop=3, exact=False,
      hint='', decor=(), extra=()):
    path = [(0, 0)]
    for m in moves:
        dr, dc = MOVES[m]; r, c = path[-1]; path.append((r + dr, c + dc))
    assert len(codes) == len(path), (id, len(codes), len(path))
    cells = {p: ch for p, ch in zip(path, codes)}
    for (r, c, ch) in extra: cells[(r, c)] = ch
    allpos = list(cells) + [(d[1], d[2]) for d in decor]
    r0 = min(p[0] for p in allpos); c0 = min(p[1] for p in allpos)
    sh = lambda p: (p[0] - r0, p[1] - c0)
    cells = {sh(p): ch for p, ch in cells.items()}
    path = [sh(p) for p in path]
    assert len(set(path)) == len(path), ('path revisits', id)
    R = max(p[0] for p in list(cells) + [sh((d[1], d[2])) for d in decor]) + 1
    C = max(p[1] for p in list(cells) + [sh((d[1], d[2])) for d in decor]) + 1
    tiles = [''.join(cells.get((r, c), '.') for c in range(C)) for r in range(R)]
    lv = {"id": id, "name": name, "world": world, "tiles": tiles, "path": [list(p) for p in path],
          "items": [{"type": "strawberry", "index": i} for i in berries],
          "goal": {"index": len(path) - 1, "item": goal_item, **({"exact": True} if exact else {})},
          "maxHop": maxHop, "hint": hint,
          "decor": [{"type": t, "row": sh((r, c))[0], "col": sh((r, c))[1]} for (t, r, c) in decor]}
    validate(lv)
    return lv

def validate(lv):
    path, goal, mh = lv['path'], lv['goal']['index'], lv['maxHop']
    code = lambda i: lv['tiles'][path[i][0]][path[i][1]]
    for a, b in zip(path, path[1:]):
        assert abs(a[0] - b[0]) + abs(a[1] - b[1]) == 1, ('not adjacent', lv['id'])
    assert code(0) != 'W' and code(goal) != 'W'
    berries = [it['index'] for it in lv['items']]
    for b in berries: assert code(b) != 'W' and 0 < b < goal, ('bad berry', lv['id'], b)
    # BFS over (index, collected-mask): can we finish with every strawberry?
    full = (1 << len(berries)) - 1
    seen = {(0, 0): 0}; q = deque([(0, 0)]); best_all = None; best_any = None
    while q:
        i, m = q.popleft(); d = seen[(i, m)]
        if i == goal:
            best_any = d if best_any is None else min(best_any, d)
            if m == full: best_all = d if best_all is None else min(best_all, d)
            continue
        for n in range(1, mh + 1):
            j = i + n
            if j > goal:
                if lv['goal'].get('exact'): continue
                j = goal
            if code(j) == 'W': continue
            m2 = m | (1 << berries.index(j)) if j in berries else m
            if (j, m2) not in seen: seen[(j, m2)] = d + 1; q.append((j, m2))
    assert best_all is not None, ('cannot collect all berries', lv['id'])
    lv['_info'] = f"min moves {best_any}, with all berries {best_all}"

levels = [
  # World 1: Meadow - tiny hops
  L(1, "First Hops", 1, "RRR", "GGGG", berries=[2], maxHop=3,
    hint="Show me fingers! Hop to the star!"),
  L(2, "Strawberry Lane", 1, "RRRRR", "GGGGGG", berries=[2, 4], maxHop=3,
    hint="How many hops to the strawberry?", decor=[("flowers", 1, 1)]),
  L(3, "Little Hops", 1, "RRRRRR", "GGGGGGG", berries=[1, 3, 5], maxHop=2,
    hint="Little hops! One or two fingers.", decor=[("bush", -1, 3)]),
  L(4, "Sandy Corner", 1, "RRRDD", "GGGSSS", berries=[1, 3, 4], maxHop=3,
    hint="Hop around the corner!", decor=[("tree", 1, 1)]),
  # World 2: Turns + water
  L(5, "Zig Zag", 2, "RDRDRD", "GGSSGGS", berries=[2, 4], maxHop=3,
    hint="Zig zag! Count your hops.", decor=[("flowers", 1, 0), ("bush", 0, 2)]),
  L(6, "Little Splash", 2, "RRRRR", "GGWGGG", berries=[3, 4], maxHop=3,
    hint="Jump over the water! Don't land in it!"),
  L(7, "Around the Bush", 2, "RRRDDLLL", "GGGGGSSSS", berries=[3, 6], maxHop=4,
    hint="Hop all the way around!", decor=[("bush", 1, 1), ("flowers", 1, 2)]),
  L(8, "Bridge Day", 2, "RRRRRDDLLL", "GGBBGGSSSSS", berries=[4, 7, 9], maxHop=5,
    hint="Cross the wooden bridge!", decor=[("tree", 1, 1)]),
  # World 3: Puzzles - land exactly on the target
  L(9, "Right on the Star", 3, "RRRR", "GGGGG", maxHop=5, exact=True,
    hint="Land right on the star! Count the tiles."),
  L(10, "Stepping Stones", 3, "RRRRRR", "GWTWTWG", berries=[4], maxHop=3, exact=True,
    hint="Hop on the stones! Don't splash!"),
  L(11, "Lily River", 3, "RRRRRDDD", "GGWWGWWWG", berries=[4], maxHop=5, exact=True,
    hint="Big jumps over the river!", decor=[("tree", 2, 2)]),
  L(12, "Strawberry Pick", 3, "RRDRRDRR", "GGSSGGSSG", berries=[2, 5, 7], maxHop=4, exact=True,
    hint="Pick every strawberry, then land on the star!"),
  # World 4: Adventure
  L(13, "Long Way Round", 4, "RRRRDDDLLLUR", "GGGGGWSSSSWGG", berries=[3, 7, 9], maxHop=5,
    hint="A long, long path! Keep hopping!", decor=[("tree", 1, 2)]),
  L(14, "Number Plates", 4, "RRRRRRRR", "GNWNWWNWG", berries=[3], maxHop=4, exact=True,
    hint="Hop on the number plates!", decor=[("flowers", 1, 0), ("bush", -1, 8)]),
  L(15, "Treasure Island", 4, "RRRRRDDLLLLL", "GGWWGGSSSSWNS", goal_item="chest", berries=[4, 8, 11],
    maxHop=5, exact=True, hint="Find the treasure chest!",
    decor=[("tree", 1, 0), ("flowers", 1, 2), ("bush", 1, 3)]),
]

for lv in levels: print(lv['id'], lv['name'], lv.pop('_info'), lv['tiles'])

def dump(o):
    # compact, readable: one line per level field
    out = ['{', '  "tileKey": ' + json.dumps(TILE_KEY) + ',', '  "worlds": ' + json.dumps(
        [{"id": 1, "name": "Meadow", "icon": "🌼"}, {"id": 2, "name": "Turns & Water", "icon": "🌊"},
         {"id": 3, "name": "Puzzles", "icon": "🎯"}, {"id": 4, "name": "Adventure", "icon": "🏝️"}],
        ensure_ascii=False) + ',', '  "levels": [']
    lvls = []
    for lv in o:
        lines = ['    {'] + [f'      {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}' + ',' for k, v in lv.items()]
        lines[-1] = lines[-1][:-1]
        lvls.append('\n'.join(lines) + '\n    }')
    out.append(',\n'.join(lvls)); out += ['  ]', '}']
    return '\n'.join(out) + '\n'

text = dump(levels); json.loads(text)
open(sys.argv[1], 'w').write(text)
