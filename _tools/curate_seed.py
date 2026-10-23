"""Turn the event-history research (research/events.json) into the site's seed list.

Every value comes from the research file (each row there carries its sources). This
only tidies it for display: splits "Project Hardstyle presents: X ft: Y" into a title
and a tagline, cleans venue notes, picks the best saved poster, and leaves out the
two events that did not run publicly (the April 2020 Headhunterz show, cancelled for
COVID, and the October 2021 private event).

    python curate_seed.py <events.json> <assets-dir> <out seed-events.json>
"""
import json
import os
import re
import sys

from PIL import Image

SKIP = {("2020-04-10", "headhunterz"), ("2021-10-15", "private event")}


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:48]


def clean_name(name):
    n = re.sub(r"\s+", " ", name.replace("�", "–")).strip().rstrip(".")
    co = None
    m = re.match(r"^(HSU|Eventpro|Event ?Pro)\s*(?:&|x)\s*Project Hardstyle\s*(?:presents?|present)?\s*:?\s*", n, re.I)
    if m:
        co = m.group(1).replace("Eventpro", "Event Pro")
        n = n[m.end():]
    m = re.match(r"^Project Hardstyle\s*x\s*(Event ?Pro)\s*(?:presents?|present)?\s*:?\s*", n, re.I)
    if m:
        co = "Event Pro"
        n = n[m.end():]
    n = re.sub(r"^Project Hardstyle\s*(?:proudly\s+)?(?:presents?|present)?\s*[:\-–]?\s*", "", n, flags=re.I)
    title, tagline = n, None
    ft = re.split(r"\s*\b(?:ft|feat)\b\.?\s*:?\s*", n, maxsplit=1, flags=re.I)
    if len(ft) == 2:
        head, tail = ft[0].strip(" -–:"), ft[1].strip()
        if head:
            title, tagline = head, "ft " + tail
        else:
            title = tail
    title = title.strip(" -–:") or "Project Hardstyle"
    if co:
        tagline = (f"Presented with {co}" + (f" · {tagline}" if tagline else ""))
    return title, tagline


def venue_of(e):
    v = (e.get("venue") or "").strip()
    v = re.sub(r"\s*\(.*?\)", "", v).strip()
    if v.lower().startswith("110 grenfell street"):
        v = "110 Grenfell Street"
    return None if not v or v.lower() == "unverified" else v


def address_of(e, venue):
    a = (e.get("address") or "").strip()
    if not a or a.lower() == "unverified":
        return None
    a = re.sub(r"\s*\(.*?\)", "", a).strip()
    suburb = (e.get("suburb") or "Adelaide").strip()
    if venue and venue.lower().startswith("hindley st music hall"):
        return "149 Hindley Street, Adelaide SA 5000"
    return f"{a}, {suburb} SA"


def time_of(t):
    t = (t or "").strip().lower()
    m = re.match(r"^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$", t)
    return f"{int(m.group(1))}:{m.group(2) or '00'}{m.group(3)}" if m else None


def best_poster(e, poster_dir):
    files = []
    if e.get("poster_file"):
        files.append(e["poster_file"])
    for o in e.get("other_images") or []:
        files.append(o["file"] if isinstance(o, dict) else o)
    best, best_score = None, -1
    for f in files:
        p = os.path.join(poster_dir, f)
        if not os.path.exists(p):
            continue
        w, h = Image.open(p).size
        r = w / h
        shape = 3 if 0.65 <= r <= 0.86 else 2 if 0.94 <= r <= 1.06 else 1
        score = shape + min(w, 1500) / 1500
        if score > best_score:
            best, best_score = p, score
    return best


def main(src, assets, out):
    rows, seen = [], set()
    poster_dir = os.path.join(assets, "posters")
    for e in json.load(open(src, encoding="utf-8")):
        name = e["name"]
        if any(e["date"] == d and k in name.lower() for d, k in SKIP):
            continue
        if e["date"] == "2014-01-10":
            row = {"title": "Launch night", "date": e["date"], "tagline": None, "headliners": [], "lineup": [],
                   "description": "In Project Hardstyle's own words: \"Friday the 10th of Jan 2014, Project Hardstyle was launched!\"",
                   "age": None}
        else:
            title, tagline = clean_name(name)
            venue = venue_of(e)
            notes = " ".join(filter(None, [e.get("status"), e.get("notes")])).lower()
            row = {
                "title": title, "tagline": tagline, "date": e["date"],
                "startTime": time_of(e.get("doors")), "venue": venue,
                "suburb": (e.get("suburb") or "Adelaide") if venue else None,
                "address": address_of(e, venue),
                "headliners": [h for h in (e.get("headliners") or []) if h],
                "lineup": [x for x in (e.get("lineup") or []) if x],
                "ticketUrl": e.get("ticket_url") if (e.get("ticket_url") or "").startswith("https://") else None,
                "ticketStatus": "sold-out" if ("every release" in notes and "sold out" in notes) or "sold out" in notes.split("(")[0] else "on-sale",
                "age": "18+" if (e.get("age") or "").strip() == "18+" else None,
                "poster_file": best_poster(e, poster_dir),
            }
        base = f"{row['date']}-{slug(row['title'])}"
        rid, i = base, 2
        while rid in seen:
            rid, i = f"{base}-{i}", i + 1
        seen.add(rid)
        row["id"] = rid
        rows.append(row)

    # Titles printed on the poster or the Facebook event when Moshtix only says "Project Hardstyle"
    # (each from the research notes for that date).
    poster_titles = {"2022-03-25": "Raw vs UKHC", "2021-05-21": "Hardstyle Dedication Night",
                     "2020-12-18": "Seated Sessions #001", "2018-03-30": "Good Friday"}
    for r in rows:
        if r["date"] in poster_titles:
            r["title"] = poster_titles[r["date"]]
        if r["title"].lower().startswith("vs "):
            r["title"] = "Project Hardstyle " + r["title"]
        if r["title"].lower().startswith("x culture"):
            r["title"], r["tagline"] = "Culture Street Party", "Project Hardstyle x Culture"
        if r.get("tagline"):
            r["tagline"] = re.sub(r"\s+,", ",", r["tagline"]).replace("Mutliator", "Mutilator")

    # Tonight's show, from their own posts: the full-lineup poster (20 Oct), the set times
    # poster (22/23 Oct) and the Best Dressed caption (11 Oct). Moshtix gives 10pm to 5am.
    for r in rows:
        if r["date"] == "2026-10-24":
            r.update({
                "title": "Hardstyle Halloween",
                "tagline": "ft Noisemakers, Sickmode & Krowdexx",
                "startTime": "10:00pm", "endTime": "5:00am",
                "headliners": ["Noisemakers", "Sickmode", "Krowdexx"],
                "lineup": ["10:00pm Jazzy K", "10:50pm R3LLA", "11:20pm Annihilate & Juchs!", "12:00am Sickmode",
                           "12:30am Krowdexx", "1:00am Teal", "1:30am Tony G (10 year anniversary set)", "2:00am Noisemakers",
                           "2:30am Thredz & Adoniz", "3:10am Shazza (birthday set)", "3:40am J-Saw"],
                "ticketStatus": "final-release", "priceText": "Final release $97",
                "description": "Hosted by MC D & Midnyte. Best dressed wins a Golden Ticket: free entry to every Project Hardstyle event for an entire year.",
                "poster_file": os.path.join(assets, "brand", "poster-samples", "2026-10-21_Devlr4XpxjW_post_2816x3504.jpg"),
            })
    json.dump(rows, open(out, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    for r in rows:
        pf = os.path.basename(r.get("poster_file") or "") or "-"
        print(f"{r['date']}  {r['title'][:38]:38}  {(r.get('tagline') or '')[:34]:34}  {(r.get('venue') or '-')[:22]:22}  {pf[:46]}")
    print(len(rows), "events ->", out)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
