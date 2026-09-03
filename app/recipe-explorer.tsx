"use client";

import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

export type Recipe = {
  id: string;
  number: number;
  ingredients: [] | [string, string];
  result: string;
  note?: string;
};

type WalkthroughStep = Recipe & {
  unlockedCount: number;
  isNewElement: boolean;
};

type PathStep = Recipe & { depth: number };
type ExplorerView = "search" | "time" | "all";

type Walkthrough = {
  steps: WalkthroughStep[];
  timeStepIndex: number;
  totalElements: number;
  unresolvedRecipes: number;
};

type PlayerProfile = {
  id: string;
  name: string;
  completedSteps: number;
  createdAt: number;
};

type ProfileStore = {
  activeProfileId: string;
  profiles: PlayerProfile[];
};

const BASE_ELEMENTS = ["Земля", "Пламя", "Воздух", "Вода"];
const LEGACY_PROGRESS_KEY = "alchemy-walkthrough-progress-v1";
const PROFILES_STORAGE_KEY = "alchemy-player-profiles-v1";
const PROFILES_EVENT = "alchemy-profiles-changed";

function subscribeToProfiles(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(PROFILES_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(PROFILES_EVENT, callback);
  };
}

function getProfilesSnapshot() {
  return localStorage.getItem(PROFILES_STORAGE_KEY) ?? "";
}

function parseProfiles(snapshot: string): ProfileStore {
  try {
    const value = JSON.parse(snapshot) as Partial<ProfileStore>;
    const profiles = Array.isArray(value.profiles)
      ? value.profiles.filter(
          (profile): profile is PlayerProfile =>
            typeof profile?.id === "string" &&
            typeof profile?.name === "string" &&
            typeof profile?.completedSteps === "number",
        )
      : [];
    const activeProfileId = profiles.some((profile) => profile.id === value.activeProfileId)
      ? value.activeProfileId!
      : profiles[0]?.id ?? "";
    return { activeProfileId, profiles };
  } catch {
    return { activeProfileId: "", profiles: [] };
  }
}

function saveProfiles(store: ProfileStore) {
  localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(store));
  window.dispatchEvent(new Event(PROFILES_EVENT));
}

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

  const path: PathStep[] = [];
  const added = new Set<string>();

  function collect(element: string) {
    const solution = solve(element);
    if (!solution?.recipe) return;

    for (const ingredient of solution.recipe.ingredients) collect(ingredient);
    if (!added.has(solution.recipe.id)) {
      added.add(solution.recipe.id);
      path.push({ ...solution.recipe, depth: solution.depth });
    }
  }

  collect(target);

  return path;
}

function buildWalkthrough(recipes: Recipe[]): Walkthrough {
  const known = new Set(BASE_ELEMENTS.map(normalize));
  const unlockRecipe = recipes.find(
    (recipe) => recipe.ingredients.length === 0 && normalize(recipe.result) === normalize("Время"),
  );
  const pending = recipes.filter((recipe) => recipe.ingredients.length > 0);
  const steps: WalkthroughStep[] = [];
  let timeStepIndex = -1;

  while (pending.length > 0) {
    if (!known.has(normalize("Время")) && known.size >= 100 && unlockRecipe) {
      known.add(normalize("Время"));
      steps.push({
        ...unlockRecipe,
        unlockedCount: known.size,
        isNewElement: true,
      });
      timeStepIndex = steps.length - 1;
      continue;
    }

    const nextIndex = pending.findIndex((recipe) =>
      recipe.ingredients.every((ingredient) => known.has(normalize(ingredient))),
    );

    if (nextIndex === -1) break;

    const [recipe] = pending.splice(nextIndex, 1);
    const resultKey = normalize(recipe.result);
    const isNewElement = !known.has(resultKey);
    if (isNewElement) known.add(resultKey);

    steps.push({
      ...recipe,
      unlockedCount: known.size,
      isNewElement,
    });
  }

  return {
    steps,
    timeStepIndex,
    totalElements: known.size,
    unresolvedRecipes: pending.length,
  };
}

function FlaskIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M12 3h8M14 3v8L6.8 24.2A3.2 3.2 0 0 0 9.6 29h12.8a3.2 3.2 0 0 0 2.8-4.8L18 11V3" />
      <path d="M10 21h12M13 17h6" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
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

function HourglassIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3h12M6 21h12M7 3c0 4 1.8 6.4 5 9-3.2 2.6-5 5-5 9M17 3c0 4-1.8 6.4-5 9 3.2 2.6 5 5 5 9" />
    </svg>
  );
}

export default function RecipeExplorer({ recipes }: { recipes: Recipe[] }) {
  const [view, setView] = useState<ExplorerView>("search");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [profileCreatorOpen, setProfileCreatorOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const controlsRef = useRef<HTMLDivElement>(null);
  const walkthrough = useMemo(() => buildWalkthrough(recipes), [recipes]);
  const timeSteps = useMemo(
    () => walkthrough.steps.slice(0, walkthrough.timeStepIndex + 1),
    [walkthrough],
  );
  const elements = useMemo(() => {
    const unique = new Map<string, string>();
    for (const base of BASE_ELEMENTS) unique.set(normalize(base), base);
    for (const recipe of recipes) unique.set(normalize(recipe.result), recipe.result);
    return [...unique.values()].sort((a, b) => a.localeCompare(b, "ru"));
  }, [recipes]);
  const filteredElements = useMemo(() => {
    const needle = normalize(query);
    if (!needle) return elements.slice(0, 8);
    return elements
      .filter((element) => normalize(element).includes(needle))
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
      ? elements.filter((element) => normalize(element).includes(needle))
      : elements;
  }, [catalogQuery, elements]);
  const path = useMemo(
    () => (selected ? buildPath(selected, recipes) : []),
    [recipes, selected],
  );
  const visibleSteps = view === "time" ? timeSteps : walkthrough.steps;
  const profilesSnapshot = useSyncExternalStore(subscribeToProfiles, getProfilesSnapshot, () => "");
  const profileStore = useMemo(() => parseProfiles(profilesSnapshot), [profilesSnapshot]);
  const activeProfile = profileStore.profiles.find(
    (profile) => profile.id === profileStore.activeProfileId,
  );
  const completedSteps = Math.min(activeProfile?.completedSteps ?? 0, walkthrough.steps.length);
  const hasLearnedTime = walkthrough.timeStepIndex >= 0 && completedSteps > walkthrough.timeStepIndex;
  const visibleCompleted = Math.min(completedSteps, visibleSteps.length);
  const progressPercent = visibleSteps.length
    ? Math.round((visibleCompleted / visibleSteps.length) * 100)
    : 0;

  function chooseElement(element: string) {
    setSelected(element);
    setQuery(element);
    setSearchOpen(false);
    setCatalogOpen(false);
    setView("search");
  }

  function openTimeRoute() {
    setSearchOpen(false);
    setCatalogOpen(false);
    setView("time");
    window.setTimeout(() => {
      document.querySelector(".journey")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && filteredElements[0]) chooseElement(filteredElements[0]);
    if (event.key === "Escape") setSearchOpen(false);
  }

  function setStepCompleted(index: number) {
    if (!activeProfile) {
      setProfileCreatorOpen(true);
      return;
    }
    const nextProgress = index < completedSteps ? index : index + 1;
    saveProfiles({
      ...profileStore,
      profiles: profileStore.profiles.map((profile) =>
        profile.id === activeProfile.id
          ? { ...profile, completedSteps: nextProgress }
          : profile,
      ),
    });
  }

  function continueWalkthrough() {
    const nextIndex = Math.min(completedSteps, walkthrough.steps.length - 1);
    if (nextIndex >= timeSteps.length && view === "time") setView("all");
    window.setTimeout(() => {
      document.getElementById(`route-step-${nextIndex}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 0);
  }

  function resetProgress() {
    if (!activeProfile) return;
    saveProfiles({
      ...profileStore,
      profiles: profileStore.profiles.map((profile) =>
        profile.id === activeProfile.id ? { ...profile, completedSteps: 0 } : profile,
      ),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function createProfile() {
    const name = newProfileName.trim().slice(0, 32);
    if (!name) return;
    const legacyProgress = profileStore.profiles.length === 0
      ? Number.parseInt(localStorage.getItem(LEGACY_PROGRESS_KEY) ?? "0", 10)
      : 0;
    const profile: PlayerProfile = {
      id: crypto.randomUUID(),
      name,
      completedSteps: Number.isFinite(legacyProgress)
        ? Math.max(0, Math.min(legacyProgress, walkthrough.steps.length))
        : 0,
      createdAt: Date.now(),
    };
    saveProfiles({
      activeProfileId: profile.id,
      profiles: [...profileStore.profiles, profile],
    });
    localStorage.removeItem(LEGACY_PROGRESS_KEY);
    setNewProfileName("");
    setProfileCreatorOpen(false);
  }

  function switchProfile(profileId: string) {
    saveProfiles({ ...profileStore, activeProfileId: profileId });
  }

  function deleteActiveProfile() {
    if (!activeProfile || !window.confirm(`Удалить персонажа «${activeProfile.name}» и его прогресс?`)) return;
    const profiles = profileStore.profiles.filter((profile) => profile.id !== activeProfile.id);
    saveProfiles({ activeProfileId: profiles[0]?.id ?? "", profiles });
  }

  useEffect(() => {
    function closeSearchMenus(event: MouseEvent) {
      if (!controlsRef.current?.contains(event.target as Node)) {
        setSearchOpen(false);
        setCatalogOpen(false);
      }
    }

    document.addEventListener("mousedown", closeSearchMenus);
    return () => document.removeEventListener("mousedown", closeSearchMenus);
  }, []);

  return (
    <main className="app-shell">
      <div className="paper-grain" aria-hidden="true" />

      <header className="hero">
        <div className="profile-manager">
          <div className="profile-summary">
            <span className="profile-label">ПЕРСОНАЖИ</span>
            <small>{activeProfile ? "Выбери активного" : "Создай первого"}</small>
          </div>
          {activeProfile ? (
            <>
              <div className="profile-list" role="radiogroup" aria-label="Выбор персонажа">
                {profileStore.profiles.map((profile) => (
                  <button
                    className={`profile-chip ${profile.id === activeProfile.id ? "is-active" : ""}`}
                    type="button"
                    role="radio"
                    aria-checked={profile.id === activeProfile.id}
                    key={profile.id}
                    onClick={() => switchProfile(profile.id)}
                  >
                    <span aria-hidden="true" />
                    {profile.name}
                  </button>
                ))}
              </div>
              <button className="new-profile-button" type="button" onClick={() => setProfileCreatorOpen(true)}>+ Создать</button>
              <button className="delete-profile-button" type="button" onClick={deleteActiveProfile}>Удалить выбранного</button>
            </>
          ) : (
            <button className="new-profile-button is-primary" type="button" onClick={() => setProfileCreatorOpen(true)}>+ Создать персонажа</button>
          )}
        </div>

        <div className="brand-mark">
          <span className="brand-icon"><FlaskIcon /></span>
          <span>АЛХИМИЧЕСКИЙ СПРАВОЧНИК</span>
        </div>
        <h1>Найди путь к<br /><em>любому элементу</em></h1>
        <p className="hero-copy">
          Введи название или выбери элемент из каталога — справочник сразу построит
          полную лестницу его создания от четырёх начальных стихий.
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
                  setView("search");
                }}
                aria-label="Очистить поиск"
              >
                ×
              </button>
            )}

            {searchOpen && (
              <div className="search-results" id="search-results" role="listbox">
                {filteredElements.length ? (
                  filteredElements.map((element) => (
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected === element}
                      key={element}
                      onClick={() => chooseElement(element)}
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
                  <button key={element} type="button" onClick={() => chooseElement(element)}>
                    <span>{element}</span><span>→</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="extra-routes-heading">ДОПОЛНИТЕЛЬНЫЕ МАРШРУТЫ</div>
        <div className="route-switch extra-routes" role="group" aria-label="Дополнительные маршруты">
          <button
            className={view === "time" ? "is-active" : ""}
            type="button"
            onClick={() => setView("time")}
          >
            <HourglassIcon />
            <span><small>БЫСТРАЯ ЦЕЛЬ</small>До открытия Времени</span>
            <strong>{timeSteps.length} ступеней</strong>
          </button>
          <button
            className={view === "all" ? "is-active" : ""}
            type="button"
            onClick={() => setView("all")}
          >
            <FlaskIcon />
            <span><small>ПОЛНОЕ ПРОХОЖДЕНИЕ</small>Все рецепты</span>
            <strong>{recipes.length} ступеней</strong>
          </button>
        </div>

        <div className="stats" aria-label="Статистика справочника">
          <span><strong>{elements.length}</strong> элементов</span>
          <i />
          <span><strong>{recipes.length}</strong> рецептов</span>
          <i />
          <span><strong>4</strong> стихии</span>
        </div>
      </header>

      <section className={`journey ${view !== "search" || selected ? "has-result" : ""}`} aria-live="polite">
        {view === "search" ? (
          !selected ? (
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
                  <button key={element} type="button" onClick={() => chooseElement(element)}>{element}</button>
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
            <div className="path-content search-path">
              <div className="path-heading">
                <div>
                  <span className="eyebrow">ПУТЬ СОЗДАНИЯ</span>
                  <h2>Как создать «{selected}»</h2>
                  {!hasLearnedTime && path.some((step) => step.ingredients.length === 0 && normalize(step.result) === normalize("Время")) && (
                    <p>В одном из рецептов требуется Время. Его полный маршрут вынесен отдельно и не добавляется в эту лестницу.</p>
                  )}
                </div>
                <div className="steps-total"><strong>{path.length}</strong><span>шагов</span></div>
              </div>

              <div className="base-elements">
                <span>УЖЕ ДОСТУПНЫ</span>
                {BASE_ELEMENTS.map((element, index) => (
                  <div key={element}><small>0{index + 1}</small><strong>{element}</strong></div>
                ))}
              </div>

              <div className="ladder search-ladder">
                {path.map((step, index) => {
                  const stairPosition = index % 18;
                  const offset = (stairPosition <= 9 ? stairPosition : 18 - stairPosition) / 9 * 35;
                  const isTime = step.ingredients.length === 0;
                  const isFinal = index === path.length - 1;
                  const style = { "--step-offset": `${offset}vw` } as CSSProperties;

                  return (
                    <article className={`recipe-step ${isFinal || isTime ? "is-final" : ""} ${isTime ? "time-unlock" : ""} ${isTime && hasLearnedTime ? "is-learned-time" : ""}`} style={style} key={step.id}>
                      <div className="step-marker"><span>{isTime ? "✦" : String(index + 1).padStart(3, "0")}</span></div>
                      <div className="recipe-card">
                        <div className="card-meta">
                          <span>{isTime ? (hasLearnedTime ? "ВЫ УЖЕ ВЫУЧИЛИ ВРЕМЯ" : "ТОЛЬКО НА 100 УРОВНЕ") : isFinal ? "ФИНАЛЬНЫЙ ШАГ" : `ШАГ ${index + 1}`}</span>
                          <small>#{String(step.number).padStart(3, "0")}</small>
                        </div>
                        {isTime ? (
                          <div className="unlock-formula">
                            <span>{hasLearnedTime ? `Открыто персонажем «${activeProfile?.name}»` : "Требуется для следующих рецептов"}</span>
                            <strong><HourglassIcon /> {step.result}</strong>
                            <small>{hasLearnedTime ? "Можно использовать в следующих рецептах" : "Время открывается после получения 100 элементов"}</small>
                            {!hasLearnedTime && (
                              <button className="time-route-link" type="button" onClick={openTimeRoute}>
                                Открыть маршрут до Времени →
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="formula">
                            <button type="button" onClick={() => chooseElement(step.ingredients[0]!)}>{step.ingredients[0]}</button>
                            <span className="operator">+</span>
                            <button type="button" onClick={() => chooseElement(step.ingredients[1]!)}>{step.ingredients[1]}</button>
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
                <div><small>ГОТОВО!</small><strong>{selected}</strong></div>
                <span className="finish-spark">✦</span>
              </div>
            </div>
          )
        ) : (
        <div className="path-content walkthrough-content">
          <div className="milestones" aria-label="Этапы прохождения">
            <div className="milestone is-done">
              <span>01</span>
              <div><small>СТАРТ</small><strong>4 стихии</strong></div>
            </div>
            <i />
            <div className={`milestone ${view === "all" ? "is-done" : "is-current"}`}>
              <span>02</span>
              <div><small>100 ЭЛЕМЕНТОВ</small><strong>Открыть Время</strong></div>
            </div>
            <i />
            <div className={`milestone ${view === "all" ? "is-current" : ""}`}>
              <span>03</span>
              <div><small>ФИНАЛ</small><strong>Все рецепты</strong></div>
            </div>
          </div>

          <div className="saved-progress">
            <div className="saved-progress-copy">
              <span className="saved-icon">✓</span>
              <div>
                <small>{activeProfile ? `ПРОГРЕСС · ${activeProfile.name}` : "СОЗДАЙ ПЕРСОНАЖА ДЛЯ СОХРАНЕНИЯ"}</small>
                <strong>
                  {!activeProfile
                    ? "Прогресс пока не сохраняется"
                    : visibleCompleted >= visibleSteps.length
                    ? "Этот маршрут завершён"
                    : `Следующий шаг: ${visibleCompleted + 1} из ${visibleSteps.length}`}
                </strong>
              </div>
            </div>
            <div className="saved-progress-track" aria-label={`Выполнено ${progressPercent}%`}>
              <span style={{ width: `${progressPercent}%` }} />
            </div>
            <b>{progressPercent}%</b>
            {completedSteps > 0 && completedSteps < walkthrough.steps.length && (
              <button className="continue-button" type="button" onClick={continueWalkthrough}>Продолжить →</button>
            )}
            {completedSteps > 0 && (
              <button className="reset-button" type="button" onClick={resetProgress}>Сбросить</button>
            )}
          </div>

          <p className="progress-hint">Отметь любой рецепт — он и все ступени выше сразу станут выполненными.</p>

          <div className="path-heading">
            <div>
              <span className="eyebrow">{view === "time" ? "ЭТАП I · ПУТЬ ДО ВРЕМЕНИ" : "ПОЛНОЕ ПРОХОЖДЕНИЕ"}</span>
              <h2>{view === "time" ? "Первые сто элементов" : "Все рецепты по порядку"}</h2>
              <p>
                {view === "time"
                  ? "После сотого уникального элемента Время откроется автоматически отдельной ступенью."
                  : "Маршрут включает новые элементы и альтернативные рецепты из всего справочника."}
              </p>
            </div>
            <div className="steps-total"><strong>{visibleSteps.length}</strong><span>ступеней</span></div>
          </div>

          <div className="base-elements">
            <span>УЖЕ ДОСТУПНЫ</span>
            {BASE_ELEMENTS.map((element, index) => (
              <div key={element}><small>0{index + 1}</small><strong>{element}</strong></div>
            ))}
          </div>

          <div className="ladder full-ladder">
            {visibleSteps.map((step, index) => {
              const stairPosition = index % 18;
              const offset = (stairPosition <= 9 ? stairPosition : 18 - stairPosition) / 9 * 35;
              const style = { "--step-offset": `${offset}vw` } as CSSProperties;
              const isTime = step.ingredients.length === 0;
              const isCompleted = index < completedSteps;
              const isCurrent = index === completedSteps;

              return (
                <div key={step.id}>
                  <article
                    id={`route-step-${index}`}
                    className={`recipe-step ${isTime ? "is-final time-unlock" : ""} ${isCompleted ? "is-completed" : ""} ${isCurrent ? "is-current" : ""}`}
                    style={style}
                  >
                    <div className="step-marker"><span>{isCompleted ? "✓" : isTime ? "✦" : String(index + 1).padStart(3, "0")}</span></div>
                    <div className="recipe-card">
                      <div className="card-meta">
                        <span>
                          {isTime
                            ? "ВРЕМЯ ОТКРЫТО"
                            : step.isNewElement
                              ? `НОВЫЙ ЭЛЕМЕНТ · ${step.unlockedCount}`
                              : "АЛЬТЕРНАТИВНЫЙ РЕЦЕПТ"}
                        </span>
                        <div className="card-actions">
                          <small>#{String(step.number).padStart(3, "0")}</small>
                          <button
                            className="step-check"
                            type="button"
                            onClick={() => setStepCompleted(index)}
                            aria-label={isCompleted ? `Вернуться к шагу ${index + 1}` : `Отметить шаг ${index + 1} выполненным`}
                          >
                            {isCompleted ? "✓ Выполнено" : "Отметить готовым"}
                          </button>
                        </div>
                      </div>

                      {isTime ? (
                        <div className="unlock-formula">
                          <span>Автоматически после 100 элементов</span>
                          <strong><HourglassIcon /> Время</strong>
                          <small>Только с этой ступени разрешены рецепты, где используется Время.</small>
                        </div>
                      ) : (
                        <div className="formula">
                          <span className="ingredient-chip">{step.ingredients[0]}</span>
                          <span className="operator">+</span>
                          <span className="ingredient-chip">{step.ingredients[1]}</span>
                          <span className="operator equals">=</span>
                          <strong>{step.result}</strong>
                        </div>
                      )}
                    </div>
                  </article>

                  {view === "all" && index === walkthrough.timeStepIndex && (
                    <div className="phase-divider">
                      <span>✦</span>
                      <div><small>ЭТАП II</small><strong>Время уже открыто — продолжаем путь</strong></div>
                      <span>✦</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="finish-card">
            <span className="finish-spark">✦</span>
            <div>
              <small>{view === "time" ? "ПЕРВАЯ ЦЕЛЬ ДОСТИГНУТА" : "СПРАВОЧНИК ЗАВЕРШЁН"}</small>
              <strong>{view === "time" ? "Время открыто!" : "Все рецепты открыты!"}</strong>
            </div>
            <span className="finish-spark">✦</span>
          </div>

          {walkthrough.unresolvedRecipes > 0 && (
            <p className="route-warning">Не удалось расположить рецептов: {walkthrough.unresolvedRecipes}</p>
          )}
        </div>
        )}
      </section>

      <footer>
        <span>✦</span>
        <p>Время никогда не используется раньше открытия: порядок проверяется автоматически по всему data.txt.</p>
        <span>✦</span>
      </footer>

      {profileCreatorOpen && (
        <div className="profile-modal" role="presentation" onMouseDown={() => setProfileCreatorOpen(false)}>
          <form
            className="profile-dialog"
            onSubmit={(event) => { event.preventDefault(); createProfile(); }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className="dialog-close" type="button" onClick={() => setProfileCreatorOpen(false)} aria-label="Закрыть">×</button>
            <span className="dialog-icon"><FlaskIcon /></span>
            <small>НОВАЯ УЧЁТНАЯ ЗАПИСЬ</small>
            <h2>Кто отправляется в путь?</h2>
            <p>У каждого персонажа будет отдельный сохранённый прогресс.</p>
            <label>
              <span>Имя персонажа</span>
              <input
                value={newProfileName}
                onChange={(event) => setNewProfileName(event.target.value)}
                placeholder="Имя персонажа"
                maxLength={32}
                autoFocus
              />
            </label>
            <button className="create-profile-button" type="submit" disabled={!newProfileName.trim()}>Создать персонажа</button>
          </form>
        </div>
      )}
    </main>
  );
}
