"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useGameMode, type GameMode } from "@/components/game-mode/context";
import { cacheGet, cacheSet } from "./store";
import { fetchAll } from "./fetcher";
import type {
  CachedItem,
  CachedTask,
  CachedBarter,
  CachedCraft,
  CacheMeta,
} from "./types";
import { Group } from "@/app/lib/types/itemGroups";

const CACHE_VERSION = 3;

interface BulkCacheContextValue {
  ready: boolean;
  gameMode: GameMode;
  items: Map<string, CachedItem>;
  tasks: CachedTask[];
  barters: CachedBarter[];
  crafts: CachedCraft[];
  updateItem: (name: string, item: CachedItem) => void;
}

const BulkCacheContext = createContext<BulkCacheContextValue>({
  ready: false,
  gameMode: "regular",
  items: new Map(),
  tasks: [],
  barters: [],
  crafts: [],
  updateItem: () => {},
});

interface SyncState {
  category: string;
  count: number;
  mode: GameMode;
  status: string;
}

const STATUS_MESSAGES: Record<string, string> = {
  items: "Scavenging catalog...",
  tasks: "Contacting HQ...",
  barters: "Intercepting trader manifests...",
  crafts: "Analyzing hideout blueprints...",
};

function StartupLoader({ syncState }: { syncState: { items: number; tasks: number; barters: number; crafts: number; mode: GameMode } }) {
  const categories = ["items", "barters", "tasks", "crafts"] as const;
  
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#070707] text-[#cccccc] font-mono select-none overflow-hidden">
      {/* Grid Background */}
      <div 
        className="absolute inset-0 opacity-[0.05] pointer-events-none" 
        style={{ 
          backgroundImage: `linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)`,
          backgroundSize: '40px 40px'
        }} 
      />
      
      {/* Scanline Overlay */}
      <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.1)_50%),linear-gradient(90deg,rgba(255,0,0,0.01),rgba(0,255,0,0.005),rgba(0,0,255,0.01))] bg-[length:100%_4px,3px_100%] z-20 opacity-30" />

      <div className="max-w-xl w-full p-1 border border-[#2a2a2a] bg-[#0c0c0c] relative shadow-2xl">
        <div className="border border-[#1a1a1a] p-10 space-y-10 relative overflow-hidden">
          {/* Moving scanline */}
          <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-transparent via-[#ffffff03] to-transparent h-[2px] animate-scanline" />

          <div className="flex justify-between items-start relative z-10">
            <div className="space-y-3">
              <div className="bg-[#9a8866] text-[#000] text-[10px] font-bold px-2 py-0.5 inline-block uppercase tracking-[0.2em]">
                System Synchronizing
              </div>
              <h1 className="text-2xl font-black tracking-[0.3em] text-[#9a8866] uppercase leading-none">
                M1NDLE55 // OS
              </h1>
              <p className="text-[9px] text-[#555] uppercase tracking-[0.4em] font-bold">
                {'"this is the last time you\'ll see a loading bar"'}
              </p>
            </div>
            <div className="text-right space-y-1 relative z-10">
              <div className="text-[10px] text-[#555] font-bold uppercase tracking-widest border-b border-[#1a1a1a] pb-1 mb-1">
                Data Stream
              </div>
              <div className="text-sm font-black text-white uppercase tracking-widest">
                {syncState.mode} [X-RAY]
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-8 relative z-10">
            {categories.map((cat) => {
              const count = syncState[cat] || 0;
              const hasData = count > 0;
              
              return (
                <div key={cat} className="group flex items-center gap-6">
                  <div className={`w-1 h-8 ${hasData ? 'bg-[#9a8866]' : 'bg-[#1a1a1a]'} transition-colors duration-300`} />
                  <div className="flex-1 space-y-1.5">
                    <div className="flex justify-between text-[10px] uppercase tracking-[0.2em] font-bold">
                      <span className={hasData ? "text-[#9a8866]" : "text-[#444]"}>
                        {`// ${STATUS_MESSAGES[cat]}`}
                      </span>
                      <span className={hasData ? "text-white" : "text-[#222]"}>
                        [ {count.toString().padStart(4, '0')} RAW_DATA ]
                      </span>
                    </div>
                    <div className="relative h-[2px] w-full bg-[#111] overflow-hidden">
                      <div 
                        className={`absolute inset-y-0 left-0 bg-[#9a8866] transition-all duration-700 ease-in-out ${hasData ? 'w-full shadow-[0_0_10px_rgba(154,136,102,0.5)]' : 'w-0'}`}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-6 border-t border-[#1a1a1a] flex justify-between items-end relative z-10">
            <div className="space-y-1">
              <div className="flex gap-4 text-[8px] text-[#444] uppercase tracking-[0.4em] font-bold">
                <span className="animate-pulse text-[#666]">Connecting to Tarkov.dev API...</span>
                <span>•</span>
                <span>Writing to Local IDB...</span>
              </div>
            </div>
            <div className="text-[8px] text-[#333] font-bold tracking-[0.8em] uppercase">
              V3.0.0A
            </div>
          </div>
        </div>
      </div>
      
      <style jsx>{`
        @keyframes scanline {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(1000%); }
        }
        .animate-scanline {
          animation: scanline 8s linear infinite;
        }
      `}</style>
    </div>
  );
}

export function BulkCacheProvider({ children }: { children: React.ReactNode }) {
  const { gameMode } = useGameMode();
  const [ready, setReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncState, setSyncState] = useState<{ items: number; tasks: number; barters: number; crafts: number; mode: GameMode }>({
    items: 0,
    tasks: 0,
    barters: 0,
    crafts: 0,
    mode: "regular"
  });
  
  const [items, setItems] = useState<Map<string, CachedItem>>(new Map());
  const [tasks, setTasks] = useState<CachedTask[]>([]);
  const [barters, setBarters] = useState<CachedBarter[]>([]);
  const [crafts, setCrafts] = useState<CachedCraft[]>([]);
  const loadIdRef = useRef(0);

  const populate = useCallback(
    (data: {
      items: CachedItem[];
      tasks: CachedTask[];
      barters: CachedBarter[];
      crafts: CachedCraft[];
    }) => {
      const map = new Map<string, CachedItem>();
      for (const item of data.items) {
        if (item.name && !map.has(item.name)) {
          map.set(item.name, item);
        }
      }
      setItems(map);
      setTasks(data.tasks);
      setBarters(data.barters);
      setCrafts(data.crafts);

      const names = Array.from(map.values()).map((i) => ({ name: i.name }));
      localStorage.setItem("items", JSON.stringify(names));

      const init = localStorage.getItem("init");
      if (!init) {
        localStorage.setItem("init", "false");
        const g = localStorage.getItem("item-groups");
        const groups = g ? (JSON.parse(g) as Group[]) : [];
        if (!groups.find((g) => g.name === "Injectors")) {
          localStorage.setItem(
            "item-groups",
            JSON.stringify([
              ...groups,
              {
                name: "Injectors",
                items: [
                  "Morphine injector",
                  "L1 (Norepinephrine) injector",
                  "Trimadol stimulant injector",
                  "Adrenaline injector",
                  "Propital regenerative stimulant injector",
                  "eTG-change regenerative stimulant injector",
                  "xTG-12 antidote injector",
                  "Perfotoran (Blue Blood) stimulant injector",
                  "AHF1-M stimulant injector",
                  "Zagustin hemostatic drug injector",
                  "PNB (Product 16) stimulant injector",
                  "P22 (Product 22) stimulant injector",
                  "Meldonin injector",
                  "SJ1 TGLabs combat stimulant injector",
                  "SJ6 TGLabs combat stimulant injector",
                  "3-(b-TG) stimulant injector",
                  "2A2-(b-TG) stimulant injector",
                  "Obdolbos cocktail injector",
                  "Obdolbos 2 cocktail injector",
                  "M.U.L.E. stimulant injector",
                  "SJ9 TGLabs combat stimulant injector",
                  "SJ12 TGLabs combat stimulant injector",
                ],
              },
            ])
          );
        }
      }
    },
    []
  );

  const updateItem = useCallback(
    (name: string, item: CachedItem) => {
      setItems((prev) => {
        const next = new Map(prev);
        next.set(name, item);
        return next;
      });
      cacheGet<CachedItem[]>(`items:${gameMode}`).then((cached) => {
        if (!cached) return;
        const idx = cached.findIndex((i) => i.name === name);
        if (idx >= 0) cached[idx] = item;
        else cached.push(item);
        cacheSet(`items:${gameMode}`, cached);
      });
    },
    [gameMode]
  );

  const performFullSync = useCallback(async () => {
    setSyncing(true);
    const modes: GameMode[] = ["regular", "pve"];

    for (const mode of modes) {
      setSyncState(prev => ({ ...prev, mode, items: 0, tasks: 0, barters: 0, crafts: 0 }));
      
      const data = await fetchAll(mode, (category, current) => {
        setSyncState(prev => ({ ...prev, [category]: current }));
      });
      
      await Promise.all([
        cacheSet(`items:${mode}`, data.items),
        cacheSet(`tasks:${mode}`, data.tasks),
        cacheSet(`barters:${mode}`, data.barters),
        cacheSet(`crafts:${mode}`, data.crafts),
        cacheSet<CacheMeta>(`meta:${mode}`, {
          version: CACHE_VERSION,
          timestamp: Date.now(),
        }),
      ]);

      if (mode === gameMode) {
        populate(data);
      }
    }
    
    localStorage.setItem("full-sync-complete", "true");
    setSyncing(false);
  }, [gameMode, populate]);

  useEffect(() => {
    const thisLoadId = ++loadIdRef.current;
    setReady(false);

    const isStale = () => thisLoadId !== loadIdRef.current;

    (async () => {
      try {
        const fullSync = localStorage.getItem("full-sync-complete");
        const meta = await cacheGet<CacheMeta>(`meta:${gameMode}`);
        
        const isValid =
          fullSync &&
          meta &&
          meta.version === CACHE_VERSION;

        if (isValid) {
          const [cachedItems, cachedTasks, cachedBarters, cachedCrafts] =
            await Promise.all([
              cacheGet<CachedItem[]>(`items:${gameMode}`),
              cacheGet<CachedTask[]>(`tasks:${gameMode}`),
              cacheGet<CachedBarter[]>(`barters:${gameMode}`),
              cacheGet<CachedCraft[]>(`crafts:${gameMode}`),
            ]);

          if (isStale()) return;

          if (cachedItems && cachedItems.length > 0) {
            populate({
              items: cachedItems,
              tasks: cachedTasks ?? [],
              barters: cachedBarters ?? [],
              crafts: cachedCrafts ?? [],
            });
            setReady(true);
            return;
          }
        }

        await performFullSync();
        if (!isStale()) setReady(true);
      } catch (err) {
        console.warn("Bulk cache load failed:", err);
        setReady(true);
      }
    })();
  }, [gameMode, populate, performFullSync]);

  const value = useMemo(
    () => ({ ready, gameMode, items, tasks, barters, crafts, updateItem }),
    [ready, gameMode, items, tasks, barters, crafts, updateItem]
  );

  return (
    <BulkCacheContext.Provider value={value}>
      {syncing && <StartupLoader syncState={syncState} />}
      {children}
    </BulkCacheContext.Provider>
  );
}

export function useBulkCache(): BulkCacheContextValue {
  return useContext(BulkCacheContext);
}
