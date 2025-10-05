import { useMemo, useState } from 'react';
import type { ContraptionSaveData } from '@/game/contraptions/Contraption';

export type DeckSlot = 1 | 2 | 3;

interface DeckBuilderProps {
  onBack: () => void;
}

function readAllSavedContraptions(): ContraptionSaveData[] {
  const saved: ContraptionSaveData[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('contraption-')) {
      try {
        const data = JSON.parse(localStorage.getItem(key) || 'null');
        if (data && data.id && data.name) saved.push(data);
      } catch {}
    }
  }
  // Stable order by name then id
  saved.sort((a, b) => (a.name || '').localeCompare(b.name || '') || a.id.localeCompare(b.id));
  return saved;
}

function loadDeckIds(slot: DeckSlot): string[] {
  try {
    const raw = localStorage.getItem(`deck-${slot}`);
    if (!raw) return [];
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? ids.slice(0, 6) : [];
  } catch {
    return [];
  }
}

function saveDeckIds(slot: DeckSlot, ids: string[]) {
  localStorage.setItem(`deck-${slot}`, JSON.stringify(ids.slice(0, 6)));
}

export function DeckBuilder({ onBack }: DeckBuilderProps) {
  const all = useMemo(readAllSavedContraptions, []);
  const [slot, setSlot] = useState<DeckSlot>(1);
  const [ids, setIds] = useState<string[]>(() => loadDeckIds(1));

  const deckContraptions = ids
    .map(id => all.find(c => c.id === id))
    .filter(Boolean) as ContraptionSaveData[];

  const remaining = all.filter(c => !ids.includes(c.id));

  const switchSlot = (s: DeckSlot) => {
    // Persist current slot before switching
    saveDeckIds(slot, ids);
    setSlot(s);
    setIds(loadDeckIds(s));
  };

  const addToDeck = (id: string) => {
    if (ids.length >= 6 || ids.includes(id)) return;
    setIds([...ids, id]);
  };

  const removeFromDeck = (id: string) => {
    setIds(ids.filter(x => x !== id));
  };

  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = ids.slice();
    const [item] = next.splice(from, 1);
    if (item === undefined) return;
    next.splice(to, 0, item);
    setIds(next);
  };

  const save = () => {
    saveDeckIds(slot, ids);
    alert(`Saved Deck ${slot} (${ids.length}/6 cards).`);
  };

  return (
    <div className="deck-builder" style={{ padding: 16 }}>
      <h2>Deck Builder</h2>

      <div style={{ marginBottom: 12 }}>
        <button onClick={() => switchSlot(1)} disabled={slot === 1}>Deck 1</button>
        <button onClick={() => switchSlot(2)} disabled={slot === 2} style={{ marginLeft: 8 }}>Deck 2</button>
        <button onClick={() => switchSlot(3)} disabled={slot === 3} style={{ marginLeft: 8 }}>Deck 3</button>
      </div>

      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h3>Current Deck ({deckContraptions.length}/6)</h3>
          <div>
            {deckContraptions.length === 0 && <div style={{ opacity: 0.7 }}>Empty</div>}
            {deckContraptions.map((c, idx) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 6, border: '1px solid #ccc', marginBottom: 6 }}>
                <span style={{ width: 20, textAlign: 'right' }}>{idx + 1}.</span>
                <span style={{ flex: 1 }}>{c.name}</span>
                <button onClick={() => move(idx, Math.max(0, idx - 1))}>↑</button>
                <button onClick={() => move(idx, Math.min(ids.length - 1, idx + 1))}>↓</button>
                <button onClick={() => removeFromDeck(c.id)}>Remove</button>
              </div>
            ))}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <h3>Saved Contraptions</h3>
          <div>
            {remaining.length === 0 && <div style={{ opacity: 0.7 }}>No other contraptions saved.</div>}
            {remaining.map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 6, border: '1px solid #ccc', marginBottom: 6 }}>
                <span style={{ flex: 1 }}>{c.name}</span>
                <button disabled={ids.length >= 6} onClick={() => addToDeck(c.id)}>Add</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button onClick={save}>Save Deck</button>
        <button onClick={onBack}>Back</button>
      </div>
    </div>
  );
}

export default DeckBuilder;
