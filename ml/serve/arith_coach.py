"""
Calculator-checked arithmetic coach.

Sabi was fine-tuned on Literature, Physics and Accounting dialogues. Like any
8B language model it cannot be trusted to do arithmetic, and it may praise a
wrong number ("Exactly. So 5^6 = 20"). So when a student's question is a bare
sum such as "5^6" or "what is 144 / 12", the server answers with this coach
instead of the model. It still guides one step at a time and does not hand
over the answer, but every "yes" or "not quite" is computed, never guessed.

The coach is stateless: it rebuilds where the student is from the chat
history on every request.
"""
from __future__ import annotations

import ast
import re
from dataclasses import dataclass
from fractions import Fraction

MAX_EXPONENT = 10
MAX_ABS = 10**12
REVEAL_AFTER = 3  # misses on one step before the coach shows that step

LEAD_WORDS = re.compile(
    r"^(please |pls |plz |abeg |sabi |help me |can you |could you |"
    r"what is |what's |whats |what are |calculate |find |solve |evaluate |work out |compute |simplify |the value of |tell me )+"
)
STUCK = re.compile(
    r"^(a+h+|u+g+h+|h+m+|e+h+|o+h+|c+h+a+i+|h+a+b+a+|w+a+h+a+l+a+|kai+|e+y+a+h*|"
    r"i ?(don'?t|dont|do not|no) (know|understand|get( it)?|sabi)|idk|dunno|i'?m (lost|stuck|confused)|"
    r"confused|stuck|lost|help|help me|abeg|please|pls|hint|i give up|e (hard|too hard|dey hard)|hard)[\s!.?😩😭😢🙁]*$",
    re.I,
)


def is_stuck(text: str) -> bool:
    """'ahhh', 'I don't understand', 'abeg help': a stuck student, not gibberish."""
    return bool(STUCK.match(text.strip()))


SYMBOL = {ast.Add: "+", ast.Sub: "−", ast.Mult: "×", ast.Div: "÷", ast.Pow: "^"}


@dataclass
class Step:
    text: str          # "5 × 5"
    value: Fraction


def _clean(text: str) -> str:
    t = text.strip().lower()
    t = re.sub(r"(?<=\d),(?=\d{3})", "", t)            # 15,625 -> 15625
    t = LEAD_WORDS.sub("", t)
    t = re.sub(r"\s*(=|\?|equals)\s*\??\s*$", "", t)   # trailing "=", "?"
    t = re.sub(r"\bto the power of\b|\bto the power\b|\braised to\b", "^", t)
    t = re.sub(r"(\d+)\s*squared", r"\1^2", t)
    t = re.sub(r"(\d+)\s*cubed", r"\1^3", t)
    t = re.sub(r"\btimes\b|\bmultiplied by\b|\bx\b|[×*]", "*", t)
    t = re.sub(r"\bdivided by\b|[÷/]", "/", t)
    t = re.sub(r"\bplus\b|\badd\b", "+", t)
    t = re.sub(r"\bminus\b|\btake away\b", "-", t)
    return t.replace("^", "**").strip()


def parse(question: str):
    """Return the AST of a bare arithmetic question, or None."""
    expr = _clean(question)
    if not expr or not re.fullmatch(r"[\d\s+\-*/().]+", expr) or not re.search(r"\d\s*(\*\*|[+\-*/])\s*\(?\s*\d", expr):
        return None
    try:
        tree = ast.parse(expr, mode="eval").body
    except SyntaxError:
        return None
    return tree if _value(tree) is not None else None


def _value(node) -> Fraction | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
        return Fraction(str(node.value))
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        v = _value(node.operand)
        return None if v is None else -v
    if isinstance(node, ast.BinOp) and type(node.op) in SYMBOL:
        a, b = _value(node.left), _value(node.right)
        if a is None or b is None:
            return None
        if isinstance(node.op, ast.Pow):
            if b.denominator != 1 or not 0 <= b <= MAX_EXPONENT or abs(a) > 10**4:
                return None
            v = a ** int(b)
        elif isinstance(node.op, ast.Div):
            if b == 0:
                return None
            v = a / b
        else:
            v = {ast.Add: a + b, ast.Sub: a - b, ast.Mult: a * b}[type(node.op)]
        return v if abs(v) <= MAX_ABS else None
    return None


def fmt(v: Fraction) -> str:
    if v.denominator == 1:
        return f"{int(v):,}"
    return f"{float(v):,.2f}".rstrip("0").rstrip(".")


def _text(node) -> str:
    if isinstance(node, ast.BinOp):
        if isinstance(node.op, ast.Pow):
            return f"{_text(node.left)}^{_text(node.right)}"
        return f"({_text(node.left)} {SYMBOL[type(node.op)]} {_text(node.right)})"
    if isinstance(node, ast.UnaryOp):
        return f"-{_text(node.operand)}"
    return fmt(_value(node))


def steps_for(node) -> list[Step]:
    """Evaluation steps in order; a power a^n becomes repeated multiplication."""
    out: list[Step] = []

    def walk(n) -> Fraction:
        if not isinstance(n, ast.BinOp):
            return _value(n)
        a, b = walk(n.left), walk(n.right)
        if isinstance(n.op, ast.Pow):
            acc = a
            for _ in range(int(b) - 1):
                out.append(Step(f"{fmt(acc)} × {fmt(a)}", acc * a))
                acc *= a
            if int(b) <= 1:
                out.append(Step(f"{fmt(a)}^{int(b)}", acc if int(b) == 1 else Fraction(1)))
            return acc if int(b) >= 1 else Fraction(1)
        v = {ast.Add: a + b, ast.Sub: a - b, ast.Mult: a * b, ast.Div: a / b}[type(n.op)]
        out.append(Step(f"{fmt(a)} {SYMBOL[type(n.op)]} {fmt(b)}", v))
        return v

    walk(node)
    return out


def numbers(text: str) -> list[Fraction]:
    found = []
    for m in re.findall(r"-?\d[\d,]*(?:\.\d+)?", text):
        try:
            found.append(Fraction(m.replace(",", "")))
        except ValueError:
            pass
    return found


def _close(x: Fraction, y: Fraction) -> bool:
    return x == y or (y.denominator != 1 and abs(x - y) < Fraction(1, 100))


def tip(step: Step) -> str:
    m = re.fullmatch(r"(\S+) (.) (\S+)", step.text)
    if not m:
        return ""
    a, op, b = m.groups()
    av, bv = (Fraction(x.replace(",", "")) for x in (a, b))
    if op == "×" and bv.denominator == 1 and bv > 10 and bv % 10:
        tens = int(bv) // 10 * 10
        return f" Tip: break it up. {a} × {tens} plus {a} × {int(bv) - tens}."
    if op == "×" and av > 10 and bv <= 10:
        return f" Tip: think of {b} groups of {a}."
    if op == "×" and av.denominator == bv.denominator == 1 and av <= 12 and bv <= 12:
        return f" Tip: think of {a} friends, each buying {b} puff-puff. How many altogether?"
    if op == "÷":
        return f" Tip: how many {b}s make {a}?"
    if op == "+":
        return " Tip: add the ones first, then the tens."
    if op == "−" and bv <= 10:
        return f" Tip: count back {b} from {a}."
    if op == "−":
        return f" Tip: count up from {b} to {a}."
    return ""


def strip_subject(text: str) -> str:
    """Drop the 'Subject: Physics (WAEC/JAMB)' line Ask Sabi puts before a first question."""
    if text.startswith("Subject:") and "\n\n" in text:
        return text.split("\n\n", 1)[1]
    return text


def reply(messages: list[dict]) -> str | None:
    """Coach reply for a bare-arithmetic conversation, else None (use the model)."""
    # Ask Sabi prefixes the first message with "Subject: ..." and a blank line; look past it.
    users = [strip_subject(m["content"]) for m in messages if m["role"] == "user"]
    # The topic is the latest message that is a bare sum ("5^6"); earlier chat
    # is ignored. Lesson questions ("Question: ...") are never bare sums.
    start = next((i for i in range(len(users) - 1, -1, -1) if parse(users[i]) is not None), None)
    if start is None:
        return None
    tree = parse(users[start])
    steps = steps_for(tree)
    final = _value(tree)
    expr = _text(tree).strip("()")
    if not steps:
        return None

    k, misses, last = 0, 0, ("start", None)
    for msg in users[start + 1:]:
        if k >= len(steps):
            return None  # this sum is finished; a new topic goes to the model
        got = numbers(msg)
        if any(_close(n, final) for n in got):
            last, k = ("done", None), len(steps)
            continue
        hit = next((j for j in range(len(steps) - 1, k - 1, -1) if any(_close(n, steps[j].value) for n in got)), None)
        if hit is not None:
            last, k, misses = ("right", steps[hit]), hit + 1, 0
            continue
        misses += 1
        if misses >= REVEAL_AFTER:
            last, misses = ("reveal", steps[k]), 0
            k += 1
        else:
            last = ("wrong" if got else "stuck", got[-1] if got else None)

    if last[0] == "done":
        how = " You worked it out step by step, which is exactly how to do it in the exam." if len(steps) > 1 else ""
        return f"Yes! {expr} = {fmt(final)}. You don sabi am! 🎉{how} Try another one?"
    if k >= len(steps):  # the last step was revealed
        shown = f"{steps[-1].text} = {fmt(steps[-1].value)}." + (f" So {expr} = {fmt(final)}." if len(steps) > 1 else "")
        return f"{shown} No wahala, now you've seen how. Try a similar one yourself and tell me your answer."

    step = steps[k]
    kind = last[0]
    if kind == "start":
        intro = ""
        if isinstance(tree, ast.BinOp) and isinstance(tree.op, ast.Pow):
            base, n = fmt(_value(tree.left)), int(_value(tree.right))
            intro = f"{expr} means {base} multiplied by itself {n} times: {' × '.join([base] * n)}. "
        elif len(steps) > 1:
            intro = "Let's do this one small step at a time. "
        if len(steps) == 1:
            return f"Have a go first: what do you get for {step.text}?{tip(step)}"
        return f"{intro}Let's start: what is {step.text}?{tip(step)}"
    if kind == "right":
        return f"Yes, {last[1].text} = {fmt(last[1].value)}. ✅ Next: what is {step.text}?"
    if kind == "reveal":
        return f"Let me help with that step: {last[1].text} = {fmt(last[1].value)}. Now, what is {step.text}?{tip(step)}"
    if kind == "wrong" and misses == REVEAL_AFTER - 1:
        return f"Not quite, {fmt(last[1])} isn't it. One more try: what is {step.text}?{tip(step)} If you're still stuck, I'll show you this step."
    if kind == "wrong":
        return f"Not quite, {fmt(last[1])} isn't it. Try again: what is {step.text}?{tip(step)}"
    return f"No wahala, we'll go small small. What is {step.text}?{tip(step)}"
