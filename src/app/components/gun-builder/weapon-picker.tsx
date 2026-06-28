"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { LoaderCircle, Search } from "lucide-react";
import type { GunListItem } from "@/app/lib/types/gunBuilder";
import { useGunList } from "@/app/lib/cache/gunBuilderHooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface WeaponPickerProps {
  disabled?: boolean;
  onCreate: (weapon: GunListItem, useDefaultPreset: boolean) => void;
}

export function WeaponPicker({ disabled, onCreate }: WeaponPickerProps) {
  const { guns, loading } = useGunList();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const phrase = search.trim().toLowerCase();
    return guns
      .filter(
        (gun) =>
          !phrase ||
          gun.name.toLowerCase().includes(phrase) ||
          gun.shortName.toLowerCase().includes(phrase)
      )
      .slice(0, 80);
  }, [guns, search]);

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#555]" />
        <Input
          className="pl-9"
          value={search}
          disabled={loading || disabled}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={loading ? "Loading weapons..." : "Search weapons"}
        />
        {loading && (
          <LoaderCircle className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-[#9a8866]" />
        )}
      </div>
      <div className="max-h-[55vh] overflow-auto border border-[#1a1a1a]">
        {filtered.map((gun) => (
          <div
            key={gun.id}
            className="flex items-center gap-3 border-b border-[#121212] p-3 last:border-b-0"
          >
            <div className="flex h-14 w-20 shrink-0 items-center justify-center bg-[#050505]">
              {gun.gridImageLink && (
                <Image
                  src={gun.gridImageLink}
                  alt=""
                  width={80}
                  height={56}
                  className="max-h-12 w-auto object-contain"
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-[#ccc]">
                {gun.name}
              </p>
              <p className="text-xs text-[#777]">{gun.shortName}</p>
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
              {gun.defaultPresetId && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => onCreate(gun, true)}
                >
                  Factory
                </Button>
              )}
              <Button
                size="sm"
                disabled={disabled}
                onClick={() => onCreate(gun, false)}
              >
                Empty
              </Button>
            </div>
          </div>
        ))}
        {!loading && filtered.length === 0 && (
          <div className="p-4 text-sm text-[#777]">No weapons found.</div>
        )}
      </div>
    </div>
  );
}
