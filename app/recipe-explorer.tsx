"use client";

import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type Recipe = {
  id: string;
  number: number;
  ingredients: [] | [string, string];
  result: string;
  note?: string;
};

type PathStep = Recipe & { depth: number };

const BASE_ELEMENTS = ["Земля", "Пламя", "Воздух", "Вода"];

function normalize(value: string) {
  return value.toLocaleLowerCase("ru-RU").replaceAll("ё", "е").trim();
}

function buildPath(target: string, recipes: Recipe[]): PathStep[] {
  const byResult = new Map<string, Recipe[]>();

  for (const recipe of recipes) {
    const key = normalize(recipe.result);
    byResult.set(key, [...(byResult.get(key) ?? []), recipe]);
  }

  type Solution = { recipe: Recipe | null; cost: number; depth: number };
  const memo = new Map<string, Solution>();

  function solve(element: string, visiting = new Set<string>()): Solution | null {
    const key = normalize(element);
    if (BASE_ELEMENTS.some((base) => normalize(base) === key)) {
      return { recipe: null, cost: 0, depth: 0 };
    }
    if (memo.has(key)) return memo.get(key)!;
    if (visiting.has(key)) return null;

    const candidates = byResult.get(key) ?? [];
    let best: Solution | null = null;
    const nextVisiting = new Set(visiting).add(key);

    for (const recipe of candidates) {
      if (recipe.ingredients.length === 0) {
        const solution = { recipe, cost: 1, depth: 1 };
        if (!best || solution.cost < best.cost) best = solution;
        continue;
      }

      const left = solve(recipe.ingredients[0], nextVisiting);
      const right = solve(recipe.ingredients[1], nextVisiting);
      if (!left || !right) continue;

      const solution = {
        recipe,
        cost: left.cost + right.cost + 1,
        depth: Math.max(left.depth, right.depth) + 1,
      };
      if (!best || solution.cost < best.cost) best = solution;
    }

    if (best) memo.set(key, best);
    return best;
  }

  const steps: PathStep[] = [];
  const added = new Set<string>();

  function collect(element: string) {
    const solution = solve(element);
    if (!solution?.recipe) return;

    for (const ingredient of solution.recipe.ingredients) collect(ingredient);
    if (!added.has(solution.recipe.id)) {
      added.add(solution.recipe.id);
      steps.push({ ...solution.recipe, depth: solution.depth });
    }
  }

  collect(target);
  return steps;
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function FlaskIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M12 3h8M14 3v8L6.8 24.2A3.2 3.2 0 0 0 9.6 29h12.8a3.2 3.2 0 0 0 2.8-4.8L18 11V3" />
      <path d="M10 21h12M13 17h6" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z" />
      <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5v-16Z" />
    </svg>
  );
}

export default function RecipeExplorer({ recipes }: { recipes: Recipe[] }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const controlsRef = useRef<HTMLDivElement>(null);

  const elements = useMemo(() => {
    const unique = new Map<string, string>();
    for (const base of BASE_ELEMENTS) unique.set(normalize(base), base);
    for (const recipe of recipes) unique.set(normalize(recipe.result), recipe.result);
    return [...unique.values()].sort((a, b) => a.localeCompare(b, "ru"));
  }, [recipes]);

  const filtered = useMemo(() => {
    const needle = normalize(query);
    if (!needle) return elements.slice(0, 8);
    return elements
      .filter((item) => normalize(item).includes(needle))
      .sort((a, b) => {
        const aStarts = normalize(a).startsWith(needle) ? 0 : 1;
        const bStarts = normalize(b).startsWith(needle) ? 0 : 1;
        return aStarts - bStarts || a.localeCompare(b, "ru");
      })
      .slice(0, 8);
  }, [elements, query]);

  const catalogItems = useMemo(() => {
    const needle = normalize(catalogQuery);
    return needle
      ? elements.filter((item) => normalize(item).includes(needle))
      : elements;
  }, [catalogQuery, elements]);

  const path = useMemo(
    () => (selected ? buildPath(selected, recipes) : []),
    [recipes, selected],
  );

  function choose(element: string) {
    setSelected(element);
    setQuery(element);
    setSearchOpen(false);
    setCatalogOpen(false);
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && filtered[0]) choose(filtered[0]);
    if (event.key === "Escape") setSearchOpen(false);
  }

  useEffect(() => {
    function closeMenus(event: MouseEvent) {
      if (!controlsRef.current?.contains(event.target as Node)) {
        setSearchOpen(false);
        setCatalogOpen(false);
      }
    }
    document.addEventListener("mousedown", closeMenus);
    return () => document.removeEventListener("mousedown", closeMenus);
  }, []);

  return (
    <main className="app-shell">
      <div className="paper-grain" aria-hidden="true" />
      <header className="hero">
        <div className="brand-mark">
          <span className="brand-icon"><FlaskIcon /></span>
          <span>АЛХИМИЧЕСКИЙ СПРАВОЧНИК</span>
        </div>
        <h1>Найди путь к<br /><em>любому элементу</em></h1>
        <p className="hero-copy">
          Выбери нужный элемент — и получи полную цепочку его создания,
          от четырёх стихий до финального результата.
        </p>

        <div className="finder" ref={controlsRef}>
          <div className="search-wrap">
            <SearchIcon />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSearchOpen(true);
                setCatalogOpen(false);
              }}
              onFocus={() => {
                setSearchOpen(true);
                setCatalogOpen(false);
              }}
              onKeyDown={onSearchKeyDown}
              placeholder="Что будем создавать?"
              aria-label="Поиск элемента"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={searchOpen}
              aria-controls="search-results"
              autoComplete="off"
            />
            {query && (
              <button
                className="clear-search"
                type="button"
                onClick={() => {
                  setQuery("");
                  setSelected("");
                  setSearchOpen(true);
                }}
                aria-label="Очистить поиск"
              >
                ×
              </button>
            )}

            {searchOpen && (
              <div className="search-results" id="search-results" role="listbox">
                {filtered.length ? (
                  filtered.map((element) => (
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected === element}
                      key={element}
                      onClick={() => choose(element)}
                    >
                      <span className="result-gem" aria-hidden="true" />
                      <span>{element}</span>
                      <small>Найти путь</small>
                    </button>
                  ))
                ) : (
                  <p>Такого элемента пока нет</p>
                )}
              </div>
            )}
          </div>

          <span className="finder-or">или</span>

          <button
            className={`catalog-button ${catalogOpen ? "is-open" : ""}`}
            type="button"
            onClick={() => {
              setCatalogOpen((open) => !open);
              setSearchOpen(false);
            }}
            aria-expanded={catalogOpen}
          >
            <BookIcon />
            <span>Все элементы</span>
            <span className="chevron">⌄</span>
          </button>

          {catalogOpen && (
            <div className="catalog-panel">
              <div className="catalog-heading">
                <div>
                  <span>КАТАЛОГ</span>
                  <strong>Все элементы</strong>
                </div>
                <span className="catalog-count">{elements.length}</span>
              </div>
              <label className="catalog-search">
                <SearchIcon />
                <input
                  value={catalogQuery}
                  onChange={(event) => setCatalogQuery(event.target.value)}
                  placeholder="Фильтр списка..."
                  autoFocus
                />
              </label>
              <div className="catalog-list">
                {catalogItems.map((element) => (
                  <button key={element} type="button" onClick={() => choose(element)}>
                    <span>{element}</span><span>→</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="stats" aria-label="Статистика справочника">
          <span><strong>{elements.length}</strong> элементов</span>
          <i />
          <span><strong>{recipes.length}</strong> рецептов</span>
          <i />
          <span><strong>4</strong> стихии</span>
        </div>
      </header>

      <section className={`journey ${selected ? "has-result" : ""}`} aria-live="polite">
        {!selected ? (
          <div className="empty-state">
            <div className="empty-orbit" aria-hidden="true">
              <span>✦</span>
              <div><FlaskIcon /></div>
            </div>
            <span className="eyebrow">НАЧНИ ПОИСК</span>
            <h2>Здесь появится твой путь</h2>
            <p>Введи название элемента или выбери его из каталога сверху.</p>
            <div className="quick-picks">
              {["Пицца", "Радуга", "Дракон"].map((element) => (
                <button key={element} type="button" onClick={() => choose(element)}>{element}</button>
              ))}
            </div>
          </div>
        ) : path.length === 0 ? (
          <div className="base-result">
            <span className="eyebrow">БАЗОВАЯ СТИХИЯ</span>
            <div className="base-symbol">✦</div>
            <h2>{selected}</h2>
            <p>Она доступна с самого начала — создавать её не нужно.</p>
            <button type="button" onClick={() => { setSelected(""); setQuery(""); }}>Искать другой элемент</button>
          </div>
        ) : (
          <div className="path-content">
            <div className="path-heading">
              <div>
                <span className="eyebrow">ПУТЬ СОЗДАНИЯ</span>
                <h2>Как создать «{selected}»</h2>
              </div>
              <div className="steps-total"><strong>{path.length}</strong><span>шагов</span></div>
            </div>

            <div className="ladder">
              {path.map((step, index) => {
                const offset = path.length === 1 ? 0 : (index / (path.length - 1)) * 35;
                const isFinal = index === path.length - 1;
                const style = { "--step-offset": `${offset}vw` } as CSSProperties;
                return (
                  <article className={`recipe-step ${isFinal ? "is-final" : ""}`} style={style} key={step.id}>
                    <div className="step-marker"><span>{String(index + 1).padStart(2, "0")}</span></div>
                    <div className="recipe-card">
                      <div className="card-meta">
                        <span>{isFinal ? "ФИНАЛЬНЫЙ ШАГ" : `ШАГ ${index + 1}`}</span>
                        <small>РЕЦЕПТ #{String(step.number).padStart(3, "0")}</small>
                      </div>
                      {step.ingredients.length === 0 ? (
                        <div className="unlock-formula">
                          <span>Открывается автоматически</span>
                          <strong>{step.result}</strong>
                          <small>{step.note}</small>
                        </div>
                      ) : (
                        <div className="formula">
                          <button type="button" onClick={() => choose(step.ingredients[0]!)}>{step.ingredients[0]}</button>
                          <span className="operator">+</span>
                          <button type="button" onClick={() => choose(step.ingredients[1]!)}>{step.ingredients[1]}</button>
                          <span className="operator equals">=</span>
                          <strong>{step.result}</strong>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="finish-card">
              <span className="finish-spark">✦</span>
              <div>
                <small>ГОТОВО!</small>
                <strong>{selected}</strong>
              </div>
              <span className="finish-spark">✦</span>
            </div>
          </div>
        )}
      </section>

      <footer>
        <span>✦</span>
        <p>Следуй рецептам по порядку — каждый новый элемент пригодится на следующей ступени.</p>
        <span>✦</span>
      </footer>
    </main>
  );
}
