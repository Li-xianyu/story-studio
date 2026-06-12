export function splitNarrativeParagraphs(text) {
  return String(text || "").replace(/\r\n?/g, "\n").split(/\n\s*\n+/).map(function (item) {
    return item.trim();
  }).filter(Boolean);
}

export function splitNarrativeSentences(text) {
  var value = String(text || "").trim();
  if (!value) return [];
  var parts = [];
  var dialoguePattern = /([“「『"])([\s\S]*?)([”」』"])/g;
  var cursor = 0;
  var match;
  while ((match = dialoguePattern.exec(value))) {
    pushNarrativeSentences(parts, value.slice(cursor, match.index));
    parts.push((match[1] + match[2] + match[3]).trim());
    cursor = match.index + match[0].length;
  }
  pushNarrativeSentences(parts, value.slice(cursor));
  return parts.filter(Boolean);
}

function pushNarrativeSentences(parts, text) {
  var matches = String(text || "").match(/[^。！？!?…]+(?:[。！？!?…]+[）)]*)?|.+$/g) || [];
  matches.forEach(function (item) {
    var value = item.trim();
    if (value) parts.push(value);
  });
}

export function parseAnnotatedNarrative(raw) {
  var value = String(raw || "");
  var marker = "\n[[VOICE_MAP]]";
  var markerIndex = value.indexOf(marker);
  if (markerIndex < 0) return { content: value.trim(), speechTrack: [] };

  var content = value.slice(0, markerIndex).trim();
  var block = value.slice(markerIndex + marker.length);
  var endIndex = block.indexOf("[[/VOICE_MAP]]");
  if (endIndex >= 0) block = block.slice(0, endIndex);

  var speechTrack = block.split(/\r?\n/).map(function (line) {
    var match = line.trim().match(/^(\d+)\s*:\s*([nmf,\s]+)$/i);
    if (!match) return null;
    return {
      paragraph: Number(match[1]),
      voices: match[2].toLowerCase().split(",").map(function (voice) {
        return ["m", "f"].includes(voice.trim()) ? voice.trim() : "n";
      }),
    };
  }).filter(Boolean);

  return { content: content, speechTrack: speechTrack };
}

export function buildSpeechAnnotationInput(text) {
  return splitNarrativeParagraphs(text).map(function (paragraph, paragraphIndex) {
    return splitNarrativeSentences(paragraph).map(function (sentence, sentenceIndex) {
      return paragraphIndex + "." + sentenceIndex + " " + sentence;
    }).join("\n");
  }).join("\n\n");
}

export function parseSpeechAnnotation(raw) {
  var tracks = new Map();
  String(raw || "").split(/\r?\n/).forEach(function (line) {
    var match = line.trim().match(/^(\d+)\.(\d+)\s*[:=]\s*([nmf])$/i);
    if (!match) return;
    var paragraph = Number(match[1]);
    var sentence = Number(match[2]);
    if (!tracks.has(paragraph)) tracks.set(paragraph, []);
    tracks.get(paragraph)[sentence] = match[3].toLowerCase();
  });
  return Array.from(tracks.entries()).map(function (entry) {
    return {
      paragraph: entry[0],
      voices: entry[1].map(function (voice) { return voice || "n"; }),
    };
  });
}

export function visibleNarrativeWhileStreaming(raw) {
  var value = String(raw || "");
  var marker = "\n[[VOICE_MAP]]";
  var markerIndex = value.indexOf(marker);
  if (markerIndex >= 0) return value.slice(0, markerIndex);

  var keep = marker.length - 1;
  var tail = value.slice(-keep);
  for (var length = Math.min(tail.length, keep); length > 0; length -= 1) {
    if (marker.startsWith(tail.slice(-length))) return value.slice(0, -length);
  }
  return value;
}

export function buildSpeechPlan(segments) {
  var sentencePlan = [];
  var paragraphIndex = 0;
  (segments || []).forEach(function (segment) {
    var labelsByParagraph = new Map((segment.speechTrack || []).map(function (entry) {
      return [Number(entry.paragraph), entry.voices || []];
    }));
    splitNarrativeParagraphs(segment.content).forEach(function (paragraph, localIndex) {
      var sentences = splitNarrativeSentences(paragraph);
      var labels = labelsByParagraph.get(localIndex) || [];
      sentences.forEach(function (sentence, sentenceIndex) {
        sentencePlan.push({
          text: sentence,
          voice: labels[sentenceIndex] || "n",
          paragraph: paragraphIndex,
        });
      });
      paragraphIndex += 1;
    });
  });
  var plan = [];
  sentencePlan.forEach(function (item) {
    var previous = plan[plan.length - 1];
    if (previous && previous.voice === item.voice && previous.paragraph === item.paragraph) {
      previous.text += item.text;
      return;
    }
    plan.push({
      text: item.text,
      voice: item.voice,
      paragraph: item.paragraph,
    });
  });
  return plan;
}
