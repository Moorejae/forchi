"""ForChi stitcher - tone-contrast clip picker from media/clips/manifest.json.

Picks one clip segment per phrase, oscillating cool<->warm and dark<->bright,
matching mood to phrase sentiment, avoiding repeats (freshness) and drops.
"""
import json, os, random
from _paths import BASE

MANIFEST = os.path.join(BASE, 'media', 'clips', 'manifest.json')
SEGMENTS_DIR = os.path.join(BASE, 'media', 'clips', 'segments')


def load_pool(seed=None):
    with open(MANIFEST, encoding='utf-8') as f:
        entries = json.load(f)
    pool = [e for e in entries if e.get('usable') and os.path.exists(os.path.join(SEGMENTS_DIR, e['file']))]
    if seed is not None:
        random.seed(seed)
    random.shuffle(pool)
    return pool


def phrase_mood(phrase):
    """Map phrase text to a mood hint (keywords)."""
    t = phrase.lower()
    pairs = [
        (['dark', 'evil', 'monster', 'wicked', 'hell', 'shadow', 'fear', 'death', 'morals', 'fall'],
         'dark', 'cool'),
        (['light', 'good', 'hope', 'return', 'linger', 'love', 'peace'], 'hopeful', 'warm'),
        (['truth', 'know', 'understand', 'thinking'], 'melancholic', 'cool'),
        (['break', 'contrast', 'shatter', 'moment'], 'tense', 'warm'),
    ]
    for kws, mood, temp in pairs:
        if any(k in t for k in kws):
            return mood, temp
    return 'melancholic', 'cool'


USAGE_FILE = os.path.join(BASE, 'temp_media', 'clip_usage.json')
def _load_usage():
    try:
        return json.load(open(USAGE_FILE, encoding='utf-8'))
    except Exception:
        return {}
def _save_usage(u):
    try:
        json.dump(u, open(USAGE_FILE, 'w', encoding='utf-8'))
    except Exception:
        pass

def pick_clips(phrases, seed=None):
    """Return list of {file, path, mood, color_temp} for each phrase."""
    pool = load_pool(seed=seed)
    if not pool:
        raise SystemExit('no usable clips in manifest')
    # GLOBAL freshness across videos: avoid clips used in the most recent shorts
    # (persisted) so the same clips don't repeat over and over day to day.
    usage = _load_usage()
    recent = set(usage.get('recent', []))
    # split pool by color_temp
    warm = [e for e in pool if e.get('color_temp') == 'warm']
    cool = [e for e in pool if e.get('color_temp') == 'cool']
    neutral = [e for e in pool if e.get('color_temp') not in ('warm', 'cool')]

    # freshness trackers (recent clips are treated as used until the pool forces reuse)
    used_ids = set(recent)
    last_temp = None

    def take(src_list, prefer_mood=None):
        # prefer a mood match, else first not-used
        for e in src_list:
            if e['file'] in used_ids:
                continue
            if prefer_mood and e.get('mood') != prefer_mood:
                continue
            return e
        for e in src_list:
            if e['file'] not in used_ids:
                return e
        # pool exhausted - allow reuse
        return src_list[0]

    picks = []
    for ph in phrases:
        mood, want_temp = phrase_mood(ph)
        # oscillate: if same as last, prefer the other temp
        if last_temp == want_temp:
            want_temp = 'warm' if want_temp == 'cool' else 'cool'
        src = warm if want_temp == 'warm' else (cool if want_temp == 'cool' else neutral)
        e = take(src, prefer_mood=mood)
        if e is None:
            e = take(neutral if src is not neutral else pool)
        used_ids.add(e['file'])
        last_temp = e.get('color_temp')
        picks.append({
            'file': e['file'],
            'path': os.path.join(SEGMENTS_DIR, e['file']),
            'mood': e.get('mood'),
            'color_temp': e.get('color_temp'),
        })
    # persist this short's clip usage for global freshness (keep the last ~20 clips)
    for p in picks:
        recent = [f for f in usage.get('recent', []) if f != p['file']] + [p['file']]
        usage['recent'] = recent[-20:]
    _save_usage(usage)
    return picks


if __name__ == '__main__':
    import sys
    phrases = sys.argv[1:] or ['We love to believe that evil is a monster born in the dark.',
                               'But the truth of human nature is far more terrifying.',
                               'The most dangerous darkness does not come from the wicked.',
                               'It comes from the exact moment a good person decides to let go.',
                               'Because when the righteous finally fall they teach us what hell looks like.']
    picks = pick_clips(phrases, seed=42)
    for p in picks:
        print(f"  {p['color_temp']:5} {p['mood']:12} {p['file']}")
