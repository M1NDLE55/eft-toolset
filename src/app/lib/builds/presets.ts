import type { BuildItemData, BuildNode, PresetContents } from "@/app/lib/types/gunBuilder";

interface Candidate {
  owner: number;
  slotId: string;
}

export function reconstructPresetTree(
  weaponId: string,
  preset: PresetContents,
  data: ReadonlyMap<string, BuildItemData>
): BuildNode {
  const entries = [weaponId, ...withoutFirst(preset.itemIds, weaponId)];
  const candidates = entries.map((itemId, index) => {
    if (index === 0) return [];
    const options: { candidate: Candidate; distance: number }[] = [];
    entries.forEach((ownerId, owner) => {
      if (owner === index) return;
      for (const slot of data.get(ownerId)?.slots ?? []) {
        if (!slot.allowedItemIds.includes(itemId)) continue;
        const distance = owner < index ? index - owner : entries.length + owner - index;
        options.push({ candidate: { owner, slotId: slot.id }, distance });
      }
    });
    return options.sort((a, b) => a.distance - b.distance).map((option) => option.candidate);
  });

  const slotHolder = new Map<string, number>();
  const assigned = new Map<number, Candidate>();
  const slotKey = (candidate: Candidate) => `${candidate.owner}:${candidate.slotId}`;

  function augment(index: number, visited: Set<string>): boolean {
    for (const candidate of candidates[index]) {
      const key = slotKey(candidate);
      if (visited.has(key)) continue;
      visited.add(key);
      const holder = slotHolder.get(key);
      if (holder === undefined || augment(holder, visited)) {
        slotHolder.set(key, index);
        assigned.set(index, candidate);
        return true;
      }
    }
    return false;
  }

  for (let index = 1; index < entries.length; index += 1) augment(index, new Set());

  const nodes = entries.map<BuildNode>((itemId) => ({ itemId, slots: {} }));
  const children = new Map<number, { index: number; slotId: string }[]>();
  for (const [index, candidate] of assigned) {
    const list = children.get(candidate.owner) ?? [];
    list.push({ index, slotId: candidate.slotId });
    children.set(candidate.owner, list);
  }
  const stack = [0];
  const reached = new Set([0]);
  while (stack.length > 0) {
    const owner = stack.pop()!;
    for (const { index, slotId } of children.get(owner) ?? []) {
      if (reached.has(index)) continue;
      reached.add(index);
      nodes[owner].slots[slotId] = nodes[index];
      stack.push(index);
    }
  }
  return nodes[0];
}

function withoutFirst(values: string[], value: string) {
  const index = values.indexOf(value);
  return index === -1 ? values : [...values.slice(0, index), ...values.slice(index + 1)];
}
