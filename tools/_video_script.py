"""ForChi script generator - writes a Victor Moore Short script via Gemini.

Persona formula (from the docx blueprint):
  aphoristic open -> brutal subversion -> high-contrast imagery -> FINAL ANCHOR
Lexicon: shadow, ego, contrast, graveyard, monster, morals, ruthless, wicked, hell...
"""
import urllib.request, json, re, os
from _paths import BASE

PERSONA_PROMPT = """You are the writer for a philosophical YouTube Short channel. The persona is "Victor Moore" — a deep, slow, somber voice of reason who writes romantic, faith-tinged poetry about love and human nature.

The channel owner's own writing style (study these, mirror the rhythm and intimacy):
- "I have spent my entire life consumed by the thought of you, and the only thing that breaks my heart is knowing that one day my time will run out."
- "But if death is nothing more than a quiet sleep, I promise to rest right beside you like I never left."
- "Love doesn't end when the time runs out."
- "Do not let the fear of tomorrow steal the words you can say today."

Voice qualities to copy: first-person, intimate, flowing long sentences mixed with short punches; tender metaphors (sleep/death/light/shadow/quiet/faith); direct address to "you"; melancholy warmth, never cold, never preachy.

THEME NICHES — three posting pillars (blend 1-2 per script, always under the philosophical/poetic voice):
- ROMANCE & RELATIONSHIP: dating, first love, devotion, longing, the ache of waiting, what we owe the people we love, staying when it is hard, the quiet work of love, love that outlasts time.
- LIFE & PHILOSOPHY: why we lie to ourselves, the stories we tell to survive, fear disguised as caution, the masks we wear, the illusion of safety and the tyranny of tomorrow, outgrowing what no longer fits, the cost of virtue.
- FAMILY & CHRISTIAN MORAL: grace, redemption, faith as strength, loving thy neighbor, humility, family and the weight of duty, forgiveness as a discipline, christian hope in a broken world, the quiet sacrifice that holds the world together.

THE VICTOR MOORE LINGUISTIC & PSYCHOLOGICAL BLUEPRINT:
CORE TENETS (draw from them):
- The Duality of Man: morality is measured by contrast; good and evil define one another.
- The Tyranny of Time: time is finite and depleting; hesitation is a tragic flaw.
- The Illusion of Safety: comfort and the belief in "tomorrow" are dangerous lies we tell ourselves.
- The Weight of Empathy: giving is a draining but necessary sacrifice that holds the world together.

TONE:
- Urgency: sentences sometimes end abruptly to mimic the suddenness of loss or realization.
- Cynical Realism: strip away romanticized notions, then rebuild the truth as tenderness.
- Authoritative Detachment: speak as an observer of human folly, the "auditor of the soul".

THREE GENERATIVE TECHNIQUES (use at least one, blend up to two; ALWAYS invent your own objects/images — never copy the examples):
A) OBJECT-EMOTION TRANSMUTATION — assign emotional labor to a mundane object to show invisible, unappreciated suffering. (e.g. a coat that still carries someone's scent, a chair that remembers, a doorstep that learned to wait.)
B) REDEFINITION OF ACTION — take a familiar experience and redefine it as an inescapable, slightly painful necessity. State what a cliché does NOT mean, then redefine it. (e.g. "Growing up does not mean outgrowing the people you love...")
C) SUBVERSION OF COMFORT — frame happiness not as a baseline but as a rare relief after a storm; address peace as something to surrender to, implying past suffering.

STRUCTURE (follow exactly):
1. APHORISTIC OPENING — a calm, quotable, universally accepted truth.
2. SUBVERSION — quietly turn it; the truth underneath is unsettling, or achingly tender.
3. HIGH-CONTRAST IMAGERY — stark juxtapositions (light/dark, storm/peace, faith/doubt, together/alone).
4. FINAL ANCHOR — one definitive, inescapable closing line.

STYLE RULES (mandatory):
- 75-110 words total (about 35-45 seconds spoken slowly). Aim for a complete piece — do not be brief.
- Deep baritone pacing: mix short punchy sentences (4-12 words) with one or two long flowing ones.
- Use the lexicon naturally: shadow, ego, contrast, grace, quiet, sleep, remember, never, faith, love, time, soul, dark, light, truth, wait, rest.

OPENING VARIETY (CRITICAL — the channel was sounding repetitive):
- NEVER start with "We are told that", "We are taught that", "We often", or any "We are ___ that ___" formula.
- Vary how each script opens. Rotate among different opening moves, for example:
  * a direct image ("The porch light has been on for years."),
  * a question ("Have you ever loved someone you could not reach?"),
  * a confession ("I have been afraid of silence my whole life."),
  * a scene ("There is a chair that still waits by the window."),
  * a command ("Put down the tomorrow you are saving."),
  * a cold fact ("Every graveyard is full of words that were never said."),
  * a definition ("Love is not a feeling; it is a decision you keep making.").
- Do NOT reuse the opening sentence, the "It is not." subversion formula every time, or the same
  closing structure across scripts. Each script must feel like a NEW piece, not a rewrite of the last.

- END ON THE FINAL ANCHOR LINE. Do NOT end with a question.
- No narration markers, no quotes, no numbering, no meta commentary. Output ONLY the spoken words.
- Do NOT explain.

Write ONE complete script now."""


def _keys():
    for line in open(os.path.join(BASE, '.env'), encoding='utf-8'):
        if line.startswith('GEMINI_KEYS='):
            return [k.strip() for k in line.split('=', 1)[1].strip().split(',') if k.strip()]
    return []


# ── Anti-repetition memory ───────────────────────────────────────────────────
# Every generated script is stored; new scripts are checked for n-gram overlap
# with the history so ForChi never repeats a poem, a metaphor, or a closing line.
HISTORY_PATH = os.path.join(BASE, 'temp_media', 'script_history.json')

# Three posting pillars (must stay in sync with src/workflows/video/index.js
# TOPIC_CATEGORIES): Romance & Relationship / Life & Philosophy / Family & Christian Moral
TOPICS = [
    # Romance & Relationship
    'dating, romance and the ache of waiting',
    'what we owe the people we love',
    'the quiet work of a lasting relationship',
    'why we lie to ourselves about love',
    'love that outlasts time',
    # Life & Philosophy
    'human behavior and the masks we wear',
    'the cost of virtue and the weight of empathy',
    'the courage of staying when it is hard',
    'the illusion of safety and the tyranny of tomorrow',
    'outgrowing what no longer fits',
    # Family & Christian Moral
    'grace, faith and forgiveness',
    'christian hope in a broken world',
    'family, faith and the weight of duty',
    'forgiveness as a discipline',
    'the quiet sacrifice that holds the world together',
]


def _load_history():
    try:
        with open(HISTORY_PATH, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return []


def _save_history(history):
    with open(HISTORY_PATH, 'w', encoding='utf-8') as f:
        json.dump(history[-60:], f, indent=1, ensure_ascii=False)


def _n_grams(text, n=4):
    toks = re.findall(r"[a-z']+", text.lower())
    return set(tuple(toks[i:i + n]) for i in range(len(toks) - n + 1))


def _max_similarity(text, history):
    """Max 4-gram Jaccard overlap of text vs every stored script (0..1)."""
    g = _n_grams(text)
    if not g or not history:
        return 0.0
    best = 0.0
    for h in history:
        hg = _n_grams(h.get('script', ''))
        if not hg:
            continue
        inter = len(g & hg)
        best = max(best, inter / (len(g) + len(hg) - inter))
    return best


# Opening patterns that made every Short sound the same. Reject a script that
# starts with any of these so the channel varies its openings.
_BANNED_OPENINGS = [
    'we are told', 'we are taught', 'we often', 'we have been told', 'we have been taught',
    'we are raised', 'we are raised to', 'we learn', 'we have learned', 'we are always told',
]


def _banned_opening(text):
    """True if the script opens with a banned repetitive formula."""
    t = (text or '').strip().lower()
    first = ' '.join(t.split()[:6])
    return any(first.startswith(b) for b in _BANNED_OPENINGS)


def _next_topic(history):
    """Least-recently-used topic from the niche pool (anti-repeat topics)."""
    used = [h.get('topic') for h in history if h.get('topic')]
    for t in TOPICS:
        if t not in used:
            return t
    return used[-1] if used else TOPICS[0]


def _avoid_context(history, max_scripts=8):
    """Compact 'previously posted' context so the writer invents fresh imagery."""
    lines = []
    for h in history[-max_scripts:]:
        s = (h.get('script') or '').strip()
        if s:
            lines.append('- ' + s[:140])
    if not lines:
        return ''
    return ('PREVIOUSLY POSTED POEMS TO AVOID REPEATING (invent fresh objects, images and endings; '
            'do not reuse their metaphors):\n' + '\n'.join(lines) + '\n')


def generate_script(model='gemini-3.6-flash', topic=None, style=None, avoid=None):
    keys = [k for k in _keys() if k.startswith('AQ.')]
    prompt = PERSONA_PROMPT
    if style and style.lower() == 'romantic':
        prompt = prompt.replace(
            'Write a Short script following this formula:',
            'Write a ROMANTIC Short script following this formula (love, longing, the ache of time, devotion):')
    if topic:
        prompt = prompt.replace('Write ONE complete script now.',
                                f'Write ONE complete script now. Optional topic to touch on: {topic}.')
    if style and style.lower() == 'romantic':
        prompt = prompt.replace('Optional topic to touch on', 'Optional romantic topic to touch on')
    if avoid:
        prompt = prompt.replace('Write ONE complete script now.',
                                '\n' + avoid + '\nWrite ONE complete script now.')

    body = json.dumps({
        'contents': [{'parts': [{'text': prompt}]}],
        'generationConfig': {'temperature': 0.9, 'maxOutputTokens': 1500},
    }).encode()
    last_err = None
    for key in keys:
        url = f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}'
        req = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json', 'User-Agent': 'forchi'})
        try:
            r = urllib.request.urlopen(req, timeout=90)
            d = json.load(r)
            text = d['candidates'][0]['content']['parts'][0]['text'].strip()
            return text
        except urllib.error.HTTPError as e:
            last_err = f'{e.code}'
            if e.code == 429:
                continue
            raise
        except Exception as e:
            last_err = str(e)[:80]
            continue
    raise SystemExit(f'script gen failed: {last_err}')


def generate_script_checked(model='gemini-3.6-flash', topic=None, style=None, min_words=60, max_rounds=3, max_dup_tries=3):
    """Generate a fresh, NON-REPEATING script: topic rotation + anti-repetition guard.
    Returns the script text; the script (and topic) is recorded in the history store."""
    import time
    history = _load_history()
    if topic is None:
        topic = _next_topic(history)
    avoid = _avoid_context(history)
    text = generate_script(model=model, topic=topic, style=style, avoid=avoid)

    # expand rounds (Gemini truncates to ~40-50 words by default)
    for rnd in range(max_rounds):
        wc = len(text.split())
        if wc >= min_words:
            break
        print(f'  [script] {wc} words -> asking to expand (round {rnd + 1})', flush=True)
        body = json.dumps({
            'contents': [{'parts': [{'text': (
                "Below is a Victor Moore script. It is too short (a 30-45 second Short needs 75-110 words). "
                "Rewrite it LONGER, keeping the exact tone and formula (aphorism -> subversion -> contrast -> anchor). "
                "Add more imagery and sentences. Output ONLY the expanded script, no commentary.\n\n" + text
            )}]}],
            'generationConfig': {'temperature': 0.9, 'maxOutputTokens': 1500},
        }).encode()
        keys = [k for k in _keys() if k.startswith('AQ.')]
        for key in keys:
            url = f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}'
            req = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json', 'User-Agent': 'forchi'})
            try:
                r = urllib.request.urlopen(req, timeout=90)
                d = json.load(r)
                new = d['candidates'][0]['content']['parts'][0]['text'].strip()
                if len(new.split()) > wc:
                    text = new
                break
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    time.sleep(3)
                    continue
                break
            except Exception:
                break

    # anti-repetition guard: reject if too similar to any past post, rewrite fresh
    dup_tries = 0
    while (_max_similarity(text, history) > 0.28 or _banned_opening(text)) and dup_tries < max_dup_tries:
        dup_tries += 1
        reason = 'banned opening ("We are told/taught/often…")' if _banned_opening(text) else f'sim={_max_similarity(text, history):.2f}'
        print(f'  [script] rejected ({reason}) -> rewriting (try {dup_tries})', flush=True)
        text = generate_script(model=model, topic=topic, style=style,
                               avoid=avoid + '\nYour previous attempt was too close to an earlier post or used a banned opening. Write something entirely new.\n')

    # record to history (never repeat)
    history.append({'script': text.strip(), 'topic': topic, 'style': style, 'ts': int(time.time())})
    _save_history(history)
    return text.strip()


def _ensure_question(text, model='gemini-3.6-flash'):
    """Force the script to END with a question (engagement). Appends a short fitting question."""
    import re, time
    t = text.strip()
    if _ends_with_question(t):
        return t
    print('  [script] no question ending -> appending a question', flush=True)
    FALLBACKS = [
        'And what will you say when it is already too late?',
        'So what are you still waiting for?',
        'And who will you become when the silence finally answers?',
        'What words are you saving for a day that may never come?',
        'And will they know how much they meant to you, before the quiet takes you?',
        'Are you willing to lose it all before you finally say the truth?',
    ]
    prompt = (
        'Write a single short question (5-12 words), deep, somber and intimate, in the tone of a '
        'philosophical/romantic narrator named Victor Moore. It must make the listener pause and reply. '
        'Output ONLY the question, nothing else.'
    )
    body = json.dumps({'contents': [{'parts': [{'text': prompt}]}],
                       'generationConfig': {'temperature': 0.8, 'maxOutputTokens': 60}}).encode()
    keys = [k for k in _keys() if k.startswith('AQ.')]
    q = None
    for key in keys:
        url = f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}'
        req = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json', 'User-Agent': 'forchi'})
        try:
            r = urllib.request.urlopen(req, timeout=60)
            d = json.load(r)
            cand = d['candidates'][0]['content']['parts'][0]['text'].strip()
            cand = re.sub(r'\s+', ' ', cand)
            # accept only a clean short question
            if 4 <= len(cand.split()) <= 15 and cand.endswith('?') and '\n' not in cand and ':' not in cand:
                q = cand
            break
        except Exception:
            time.sleep(2)
            continue
    if q is None:
        q = FALLBACKS[int(time.time()) % len(FALLBACKS)]
    return t + ' ' + q


def _ends_with_question(text):
    t = text.strip()
    return bool(t) and t[-1] == '?'


if __name__ == '__main__':
    import sys
    topic = sys.argv[1] if len(sys.argv) > 1 else None
    style = sys.argv[2] if len(sys.argv) > 2 else None
    s = generate_script_checked(topic=topic, style=style)
    print('=== SCRIPT ===')
    print(s)
    print('=== END ===')
    print('words:', len(s.split()), '| ends_with_question:', _ends_with_question(s))