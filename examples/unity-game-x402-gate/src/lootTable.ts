/**
 * The "paid game action" this example gates behind x402: revealing one entry
 * from a fixed loot table. Deterministic and server-authoritative — the
 * client never picks its own reward, it only pays to unlock this call.
 */

export interface LootEntry {
  id: string;
  name: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  flavorText: string;
}

// A small, fixed table. Real games would back this with design data; kept
// inline here since the point of the example is the payment gate, not loot
// design.
const LOOT_TABLE: readonly LootEntry[] = [
  { id: "loot-001", name: "Cracked Sigil of the Ferryman", rarity: "common", flavorText: "Still warm from the last hand that held it." },
  { id: "loot-002", name: "Verdigris Locket", rarity: "common", flavorText: "Won't open. Won't stop ticking." },
  { id: "loot-003", name: "Ashwood Charm", rarity: "rare", flavorText: "Smells faintly of a fire that hasn't happened yet." },
  { id: "loot-004", name: "Coin of the Undertow", rarity: "rare", flavorText: "Heads on both sides." },
  { id: "loot-005", name: "Splinter of the Old Mast", rarity: "epic", flavorText: "Points north, even below deck." },
  { id: "loot-006", name: "Ferryman's Last Fare", rarity: "legendary", flavorText: "Spend it once. It always comes back." },
];

const RARITY_WEIGHTS: Record<LootEntry["rarity"], number> = {
  common: 55,
  rare: 30,
  epic: 12,
  legendary: 3,
};

/**
 * Picks a loot entry deterministically from a seed (e.g. the payer's
 * Stellar address + a per-run nonce), so the same paid request always
 * resolves to the same reward and the draw can be audited server-side.
 */
export function revealLoot(seed: string): LootEntry {
  const weightedPool = LOOT_TABLE.flatMap((entry) =>
    Array.from({ length: RARITY_WEIGHTS[entry.rarity] }, () => entry),
  );

  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }

  const entry = weightedPool[hash % weightedPool.length];
  if (!entry) {
    throw new Error("revealLoot: weighted pool was unexpectedly empty");
  }
  return entry;
}
