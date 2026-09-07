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
    ingredients: [string, string];
    result: string;
    outputs: string[];
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
    openedElements: string[];
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
        const profiles: PlayerProfile[] = Array.isArray(value.profiles)
            ? value.profiles
                  .filter(
                      (profile): profile is PlayerProfile =>
                          typeof profile?.id === "string" &&
                          typeof profile?.name === "string" &&
                          typeof profile?.completedSteps === "number",
                  )
                  .map((profile) => ({
            ...profile,
            openedElements: Array.isArray(profile.openedElements)
                ? profile.openedElements
                      .filter(
                          (element): element is string =>
                              typeof element === "string",
                      )
                      .flatMap((element) =>
                          element.split(/\s*\+\s*/).map((part) => part.trim()),
                      )
                : [],
                  }))
            : [];
        const activeProfileId = profiles.some(
            (profile) => profile.id === value.activeProfileId,
        )
            ? value.activeProfileId!
            : (profiles[0]?.id ?? "");
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

function recipeOutputs(recipe: Recipe) {
    return recipe.outputs.length ? recipe.outputs : [recipe.result];
}

function buildPath(target: string, recipes: Recipe[]): PathStep[] {
    const byResult = new Map<string, Recipe[]>();
    const available = new Set(BASE_ELEMENTS.map(normalize));

    for (const recipe of recipes) {
        for (const output of recipeOutputs(recipe)) {
            const key = normalize(output);
            byResult.set(key, [...(byResult.get(key) ?? []), recipe]);
        }
    }

    type Solution = { steps: Recipe[]; cost: number; depth: number };
    const memo = new Map<string, Solution>();

    function solve(
        element: string,
        visiting = new Set<string>(),
    ): Solution | null {
        const key = normalize(element);
        if (available.has(key)) {
            return { steps: [], cost: 0, depth: 0 };
        }
        if (memo.has(key)) return memo.get(key)!;
        if (visiting.has(key)) return null;

        const candidates = byResult.get(key) ?? [];
        let best: Solution | null = null;
        const nextVisiting = new Set(visiting).add(key);

        for (const recipe of candidates) {
            const left = solve(recipe.ingredients[0], nextVisiting);
            const right = solve(recipe.ingredients[1], nextVisiting);
            if (!left || !right) continue;

            const recipeIds = new Set<string>();
            const steps: Recipe[] = [];
            for (const step of [...left.steps, ...right.steps, recipe]) {
                if (recipeIds.has(step.id)) continue;
                recipeIds.add(step.id);
                steps.push(step);
            }
            const solution = {
                steps,
                cost: steps.length,
                depth: Math.max(left.depth, right.depth) + 1,
            };
            if (
                !best ||
                solution.cost < best.cost ||
                (solution.cost === best.cost && solution.depth < best.depth)
            ) {
                best = solution;
            }
        }

        if (best) memo.set(key, best);
        return best;
    }

    const solution = solve(target);
    return (solution?.steps ?? []).map((recipe, index) => ({
        ...recipe,
        depth: index + 1,
    }));
}

function buildWalkthrough(recipes: Recipe[]): Walkthrough {
    const known = new Set(BASE_ELEMENTS.map(normalize));
    const pending = [...recipes];
    const steps: WalkthroughStep[] = [];
    let timeStepIndex = -1;

    function appendRecipe(recipe: Recipe) {
        const outputs = recipeOutputs(recipe);
        const isNewElement = outputs.some((output) => !known.has(normalize(output)));
        for (const output of outputs) known.add(normalize(output));

        steps.push({
            ...recipe,
            unlockedCount: known.size,
            isNewElement,
        });
        if (outputs.some((output) => normalize(output) === normalize("Время"))) {
            timeStepIndex = steps.length - 1;
        }
    }

    const timePath = buildPath("Время", recipes);
    for (const pathRecipe of timePath) {
        const pendingIndex = pending.findIndex(
            (recipe) => recipe.id === pathRecipe.id,
        );
        if (pendingIndex === -1) continue;
        const [recipe] = pending.splice(pendingIndex, 1);
        appendRecipe(recipe);
    }

    while (pending.length > 0) {
        const nextIndex = pending.findIndex((recipe) =>
            recipe.ingredients.every((ingredient) =>
                known.has(normalize(ingredient)),
            ),
        );

        if (nextIndex === -1) break;

        const [recipe] = pending.splice(nextIndex, 1);
        appendRecipe(recipe);
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
        for (const recipe of recipes) {
            for (const output of recipeOutputs(recipe)) {
                unique.set(normalize(output), output);
            }
        }
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
    const visibleSteps = view === "time" ? timeSteps : walkthrough.steps;
    const profilesSnapshot = useSyncExternalStore(
        subscribeToProfiles,
        getProfilesSnapshot,
        () => "",
    );
    const profileStore = useMemo(
        () => parseProfiles(profilesSnapshot),
        [profilesSnapshot],
    );
    const activeProfile = profileStore.profiles.find(
        (profile) => profile.id === profileStore.activeProfileId,
    );
    const completedSteps = Math.min(
        activeProfile?.completedSteps ?? 0,
        walkthrough.steps.length,
    );
    const manuallyOpenedKeys = useMemo(
        () => new Set((activeProfile?.openedElements ?? []).map(normalize)),
        [activeProfile?.openedElements],
    );
    const hasLearnedTime =
        (walkthrough.timeStepIndex >= 0 &&
            completedSteps > walkthrough.timeStepIndex) ||
        manuallyOpenedKeys.has(normalize("Время"));
    const progressedElementKeys = useMemo(() => {
        const opened = new Set(BASE_ELEMENTS.map(normalize));
        for (const step of walkthrough.steps.slice(0, completedSteps)) {
            for (const output of recipeOutputs(step)) {
                opened.add(normalize(output));
            }
        }
        return opened;
    }, [completedSteps, walkthrough.steps]);
    const openedElementKeys = useMemo(() => {
        const opened = new Set(progressedElementKeys);
        for (const element of manuallyOpenedKeys) opened.add(element);
        return opened;
    }, [manuallyOpenedKeys, progressedElementKeys]);
    const path = useMemo(
        () => (selected ? buildPath(selected, recipes) : []),
        [recipes, selected],
    );
    const selectedIsBase = BASE_ELEMENTS.some(
        (element) => normalize(element) === normalize(selected),
    );
    const completedSearchSteps = path.filter((step) =>
        recipeOutputs(step).every((output) =>
            openedElementKeys.has(normalize(output)),
        ),
    ).length;
    const visibleCompleted = visibleSteps.reduce(
        (total, step, index) =>
            total +
            (index < completedSteps ||
            recipeOutputs(step).every((output) =>
                manuallyOpenedKeys.has(normalize(output)),
            )
                ? 1
                : 0),
        0,
    );
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

    function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
        if (event.key === "Enter" && filteredElements[0])
            chooseElement(filteredElements[0]);
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

    function toggleOpenedRecipe(recipe: Recipe) {
        if (!activeProfile) {
            setProfileCreatorOpen(true);
            return;
        }

        const outputKeys = new Set(recipeOutputs(recipe).map(normalize));
        const isManuallyOpened = [...outputKeys].every((outputKey) =>
            activeProfile.openedElements.some(
                (opened) => normalize(opened) === outputKey,
            ),
        );
        const openedElements = isManuallyOpened
            ? activeProfile.openedElements.filter(
                  (opened) => !outputKeys.has(normalize(opened)),
              )
            : [
                  ...activeProfile.openedElements,
                  ...recipeOutputs(recipe).filter(
                      (output) =>
                          !activeProfile.openedElements.some(
                              (opened) =>
                                  normalize(opened) === normalize(output),
                          ),
                  ),
              ];

        saveProfiles({
            ...profileStore,
            profiles: profileStore.profiles.map((profile) =>
                profile.id === activeProfile.id
                    ? { ...profile, openedElements }
                    : profile,
            ),
        });
    }

    function continueWalkthrough() {
        const nextIndex = Math.min(
            completedSteps,
            walkthrough.steps.length - 1,
        );
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
                profile.id === activeProfile.id
                    ? { ...profile, completedSteps: 0, openedElements: [] }
                    : profile,
            ),
        });
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function createProfile() {
        const name = newProfileName.trim().slice(0, 32);
        if (!name) return;
        const legacyProgress =
            profileStore.profiles.length === 0
                ? Number.parseInt(
                      localStorage.getItem(LEGACY_PROGRESS_KEY) ?? "0",
                      10,
                  )
                : 0;
        const profile: PlayerProfile = {
            id: crypto.randomUUID(),
            name,
            completedSteps: Number.isFinite(legacyProgress)
                ? Math.max(
                      0,
                      Math.min(legacyProgress, walkthrough.steps.length),
                  )
                : 0,
            openedElements: [],
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
        if (
            !activeProfile ||
            !window.confirm(
                `Удалить персонажа «${activeProfile.name}» и его прогресс?`,
            )
        )
            return;
        const profiles = profileStore.profiles.filter(
            (profile) => profile.id !== activeProfile.id,
        );
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
        return () =>
            document.removeEventListener("mousedown", closeSearchMenus);
    }, []);

    return (
        <main className="app-shell">
            <div className="paper-grain" aria-hidden="true" />

            <header className="hero">
                <div className="profile-manager">
                    <div className="profile-summary">
                        <span className="profile-label">ПЕРСОНАЖИ</span>
                        <small>
                            {activeProfile
                                ? "Выбери активного"
                                : "Создай первого"}
                        </small>
                    </div>
                    {activeProfile ? (
                        <>
                            <div
                                className="profile-list"
                                role="radiogroup"
                                aria-label="Выбор персонажа"
                            >
                                {profileStore.profiles.map((profile) => (
                                    <button
                                        className={`profile-chip ${profile.id === activeProfile.id ? "is-active" : ""}`}
                                        type="button"
                                        role="radio"
                                        aria-checked={
                                            profile.id === activeProfile.id
                                        }
                                        key={profile.id}
                                        onClick={() =>
                                            switchProfile(profile.id)
                                        }
                                    >
                                        <span aria-hidden="true" />
                                        {profile.name}
                                    </button>
                                ))}
                            </div>
                            <button
                                className="new-profile-button"
                                type="button"
                                onClick={() => setProfileCreatorOpen(true)}
                            >
                                + Создать
                            </button>
                            <button
                                className="delete-profile-button"
                                type="button"
                                onClick={deleteActiveProfile}
                            >
                                Удалить выбранного
                            </button>
                        </>
                    ) : (
                        <button
                            className="new-profile-button is-primary"
                            type="button"
                            onClick={() => setProfileCreatorOpen(true)}
                        >
                            + Создать персонажа
                        </button>
                    )}
                </div>

                <div className="brand-mark">
                    <span className="brand-icon">
                        <FlaskIcon />
                    </span>
                    <span>АЛХИМИЧЕСКИЙ СПРАВОЧНИК</span>
                </div>
                <h1>
                    Найди путь к<br />
                    <em>любому элементу</em>
                </h1>
                <p className="hero-copy">
                    Введи название или выбери элемент из каталога — справочник
                    сразу построит полную лестницу его создания от четырёх
                    начальных стихий.
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
                            <div
                                className="search-results"
                                id="search-results"
                                role="listbox"
                            >
                                {filteredElements.length ? (
                                    filteredElements.map((element) => (
                                        <button
                                            className={
                                                openedElementKeys.has(
                                                    normalize(element),
                                                )
                                                    ? "is-opened"
                                                    : ""
                                            }
                                            type="button"
                                            role="option"
                                            aria-selected={selected === element}
                                            key={element}
                                            onClick={() =>
                                                chooseElement(element)
                                            }
                                        >
                                            <span
                                                className="result-gem"
                                                aria-hidden="true"
                                            >
                                                {openedElementKeys.has(
                                                    normalize(element),
                                                )
                                                    ? "✓"
                                                    : ""}
                                            </span>
                                            <span>{element}</span>
                                            <small>
                                                {openedElementKeys.has(
                                                    normalize(element),
                                                )
                                                    ? "Уже открыто"
                                                    : "Найти путь"}
                                            </small>
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
                                <span className="catalog-count">
                                    {elements.length}
                                </span>
                            </div>
                            <label className="catalog-search">
                                <SearchIcon />
                                <input
                                    value={catalogQuery}
                                    onChange={(event) =>
                                        setCatalogQuery(event.target.value)
                                    }
                                    placeholder="Фильтр списка..."
                                    autoFocus
                                />
                            </label>
                            <div className="catalog-list">
                                {catalogItems.map((element) => (
                                    <button
                                        className={
                                            openedElementKeys.has(
                                                normalize(element),
                                            )
                                                ? "is-opened"
                                                : ""
                                        }
                                        key={element}
                                        type="button"
                                        onClick={() => chooseElement(element)}
                                    >
                                        <span>{element}</span>
                                        <span>
                                            {openedElementKeys.has(
                                                normalize(element),
                                            )
                                                ? "✓"
                                                : "→"}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="extra-routes-heading">
                    ДОПОЛНИТЕЛЬНЫЕ МАРШРУТЫ
                </div>
                <div
                    className="route-switch extra-routes"
                    role="group"
                    aria-label="Дополнительные маршруты"
                >
                    <button
                        className={view === "time" ? "is-active" : ""}
                        type="button"
                        onClick={() => setView("time")}
                    >
                        <HourglassIcon />
                        <span>
                            <small>БЫСТРАЯ ЦЕЛЬ</small>До создания Времени
                        </span>
                        <strong>{timeSteps.length} ступеней</strong>
                    </button>
                    <button
                        className={view === "all" ? "is-active" : ""}
                        type="button"
                        onClick={() => setView("all")}
                    >
                        <FlaskIcon />
                        <span>
                            <small>ПОЛНОЕ ПРОХОЖДЕНИЕ</small>Все рецепты
                        </span>
                        <strong>{recipes.length} ступеней</strong>
                    </button>
                </div>

                <div className="stats" aria-label="Статистика справочника">
                    <span>
                        <strong>{elements.length}</strong> элементов
                    </span>
                    <i />
                    <span>
                        <strong>{recipes.length}</strong> рецептов
                    </span>
                    <i />
                    <span>
                        <strong>4</strong> стихии
                    </span>
                </div>
            </header>

            <section
                className={`journey ${view !== "search" || selected ? "has-result" : ""}`}
                aria-live="polite"
            >
                {view === "search" ? (
                    !selected ? (
                        <div className="empty-state">
                            <div className="empty-orbit" aria-hidden="true">
                                <span>✦</span>
                                <div>
                                    <FlaskIcon />
                                </div>
                            </div>
                            <span className="eyebrow">НАЧНИ ПОИСК</span>
                            <h2>Здесь появится твой путь</h2>
                            <p>
                                Введи название элемента или выбери его из
                                каталога сверху.
                            </p>
                            <div className="quick-picks">
                                {["Пицца", "Радуга", "Дракон"].map(
                                    (element) => (
                                        <button
                                            key={element}
                                            type="button"
                                            onClick={() =>
                                                chooseElement(element)
                                            }
                                        >
                                            {element}
                                        </button>
                                    ),
                                )}
                            </div>
                        </div>
                    ) : path.length === 0 && selectedIsBase ? (
                        <div className="base-result">
                            <span className="eyebrow">БАЗОВАЯ СТИХИЯ</span>
                            <div className="base-symbol">✦</div>
                            <h2>{selected}</h2>
                            <p>
                                Она доступна с самого начала — создавать её не
                                нужно.
                            </p>
                            <button
                                type="button"
                                onClick={() => {
                                    setSelected("");
                                    setQuery("");
                                }}
                            >
                                Искать другой элемент
                            </button>
                        </div>
                    ) : path.length === 0 ? (
                        <div className="base-result path-error">
                            <span className="eyebrow">ЦЕПОЧКА НЕ НАЙДЕНА</span>
                            <div className="base-symbol">!</div>
                            <h2>{selected}</h2>
                            <p>
                                Для этого элемента в данных не хватает одного
                                из предыдущих рецептов.
                            </p>
                            <button
                                type="button"
                                onClick={() => {
                                    setSelected("");
                                    setQuery("");
                                }}
                            >
                                Искать другой элемент
                            </button>
                        </div>
                    ) : (
                        <div className="path-content search-path">
                            <div className="path-heading">
                                <div>
                                    <span className="eyebrow">
                                        ПУТЬ СОЗДАНИЯ
                                    </span>
                                    <h2>Как создать «{selected}»</h2>
                                    {activeProfile &&
                                        completedSearchSteps > 0 && (
                                            <p className="search-progress-summary">
                                                У персонажа «
                                                {activeProfile.name}» уже
                                                открыто {completedSearchSteps}{" "}
                                                из {path.length} шагов этой
                                                цепочки.
                                            </p>
                                        )}
                                </div>
                                <div className="steps-total">
                                    <strong>{path.length}</strong>
                                    <span>шагов</span>
                                </div>
                            </div>

                            <div className="base-elements">
                                <span>УЖЕ ДОСТУПНЫ</span>
                                {BASE_ELEMENTS.map((element, index) => (
                                    <div key={element}>
                                        <small>0{index + 1}</small>
                                        <strong>{element}</strong>
                                    </div>
                                ))}
                            </div>

                            <div className="ladder search-ladder">
                                {path.map((step, index) => {
                                    const stairPosition = index % 18;
                                    const offset =
                                        ((stairPosition <= 9
                                            ? stairPosition
                                            : 18 - stairPosition) /
                                            9) *
                                        35;
                                    const isTime =
                                        recipeOutputs(step).some(
                                            (output) =>
                                                normalize(output) ===
                                                normalize("Время"),
                                        );
                                    const isFinal = index === path.length - 1;
                                    const isProgressOpened =
                                        recipeOutputs(step).every((output) =>
                                            progressedElementKeys.has(
                                                normalize(output),
                                            ),
                                        );
                                    const isManuallyOpened =
                                        recipeOutputs(step).every((output) =>
                                            manuallyOpenedKeys.has(
                                                normalize(output),
                                            ),
                                        );
                                    const isKnown = recipeOutputs(step).every(
                                        (output) =>
                                            openedElementKeys.has(
                                                normalize(output),
                                            ),
                                    );
                                    const style = {
                                        "--step-offset": `${offset}vw`,
                                    } as CSSProperties;

                                    return (
                                        <article
                                            className={`recipe-step ${isFinal || isTime ? "is-final" : ""} ${isTime ? "time-unlock" : ""} ${isKnown ? "is-completed" : ""} ${isTime && hasLearnedTime ? "is-learned-time" : ""}`}
                                            style={style}
                                            key={step.id}
                                        >
                                            <div className="step-marker">
                                                <span>
                                                    {isKnown
                                                        ? "✓"
                                                        : isTime
                                                          ? "✦"
                                                          : String(
                                                                index + 1,
                                                            ).padStart(3, "0")}
                                                </span>
                                            </div>
                                            <div className="recipe-card">
                                                <div className="card-meta">
                                                    <span>
                                                        {isTime
                                                            ? hasLearnedTime
                                                                ? "ВЫ УЖЕ СОЗДАЛИ ВРЕМЯ"
                                                                : "СОЗДАНИЕ ВРЕМЕНИ"
                                                            : isKnown
                                                              ? `УЖЕ ОТКРЫТО · ${activeProfile?.name}`
                                                              : isFinal
                                                                ? "ФИНАЛЬНЫЙ ШАГ"
                                                                : `ШАГ ${index + 1}`}
                                                    </span>
                                                    <div className="card-actions">
                                                        <small>
                                                            #
                                                            {String(
                                                                step.number,
                                                            ).padStart(3, "0")}
                                                        </small>
                                                        <button
                                                            className={`search-step-toggle ${isKnown ? "is-checked" : ""}`}
                                                            type="button"
                                                                onClick={() =>
                                                                toggleOpenedRecipe(
                                                                    step,
                                                                )
                                                            }
                                                            disabled={
                                                                isProgressOpened &&
                                                                !isManuallyOpened
                                                            }
                                                            aria-pressed={
                                                                isManuallyOpened
                                                            }
                                                        >
                                                            {isManuallyOpened
                                                                ? "✓ Найдено"
                                                                : isProgressOpened
                                                                  ? "✓ Открыто в маршруте"
                                                                  : "Отметить найденным"}
                                                        </button>
                                                    </div>
                                                </div>
                                                <div className="formula">
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                chooseElement(
                                                                    step
                                                                        .ingredients[0]!,
                                                                )
                                                            }
                                                        >
                                                            {
                                                                step
                                                                    .ingredients[0]
                                                            }
                                                        </button>
                                                        <span className="operator">
                                                            +
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                chooseElement(
                                                                    step
                                                                        .ingredients[1]!,
                                                                )
                                                            }
                                                        >
                                                            {
                                                                step
                                                                    .ingredients[1]
                                                            }
                                                        </button>
                                                        <span className="operator equals">
                                                            =
                                                        </span>
                                                        <strong>
                                                            {step.result}
                                                        </strong>
                                                </div>
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
                    )
                ) : (
                    <div className="path-content walkthrough-content">
                        <div
                            className="milestones"
                            aria-label="Этапы прохождения"
                        >
                            <div className="milestone is-done">
                                <span>01</span>
                                <div>
                                    <small>СТАРТ</small>
                                    <strong>4 стихии</strong>
                                </div>
                            </div>
                            <i />
                            <div
                                className={`milestone ${view === "all" ? "is-done" : "is-current"}`}
                            >
                                <span>02</span>
                                <div>
                                    <small>СОЛНЦЕ + ЛУНА</small>
                                    <strong>Создать Время</strong>
                                </div>
                            </div>
                            <i />
                            <div
                                className={`milestone ${view === "all" ? "is-current" : ""}`}
                            >
                                <span>03</span>
                                <div>
                                    <small>ФИНАЛ</small>
                                    <strong>Все рецепты</strong>
                                </div>
                            </div>
                        </div>

                        <div className="saved-progress">
                            <div className="saved-progress-copy">
                                <span className="saved-icon">✓</span>
                                <div>
                                    <small>
                                        {activeProfile
                                            ? `ПРОГРЕСС · ${activeProfile.name}`
                                            : "СОЗДАЙ ПЕРСОНАЖА ДЛЯ СОХРАНЕНИЯ"}
                                    </small>
                                    <strong>
                                        {!activeProfile
                                            ? "Прогресс пока не сохраняется"
                                            : visibleCompleted >=
                                                visibleSteps.length
                                              ? "Этот маршрут завершён"
                                              : `Выполнено: ${visibleCompleted} из ${visibleSteps.length}`}
                                    </strong>
                                </div>
                            </div>
                            <div
                                className="saved-progress-track"
                                aria-label={`Выполнено ${progressPercent}%`}
                            >
                                <span
                                    style={{ width: `${progressPercent}%` }}
                                />
                            </div>
                            <b>{progressPercent}%</b>
                            {completedSteps > 0 &&
                                completedSteps < walkthrough.steps.length && (
                                    <button
                                        className="continue-button"
                                        type="button"
                                        onClick={continueWalkthrough}
                                    >
                                        Продолжить →
                                    </button>
                                )}
                            {completedSteps > 0 && (
                                <button
                                    className="reset-button"
                                    type="button"
                                    onClick={resetProgress}
                                >
                                    Сбросить
                                </button>
                            )}
                        </div>

                        <p className="progress-hint">
                            Отметь любой рецепт — он и все ступени выше сразу
                            станут выполненными.
                        </p>

                        <div className="path-heading">
                            <div>
                                <span className="eyebrow">
                                    {view === "time"
                                        ? "ЭТАП I · ПУТЬ ДО ВРЕМЕНИ"
                                        : "ПОЛНОЕ ПРОХОЖДЕНИЕ"}
                                </span>
                                <h2>
                                    {view === "time"
                                        ? "Солнце и Луна"
                                        : "Все рецепты по порядку"}
                                </h2>
                                <p>
                                    {view === "time"
                                        ? "Создай Солнце и Луну, затем соедини их, чтобы получить Время."
                                        : "Маршрут включает новые элементы и альтернативные рецепты из всего справочника."}
                                </p>
                            </div>
                            <div className="steps-total">
                                <strong>{visibleSteps.length}</strong>
                                <span>ступеней</span>
                            </div>
                        </div>

                        <div className="base-elements">
                            <span>УЖЕ ДОСТУПНЫ</span>
                            {BASE_ELEMENTS.map((element, index) => (
                                <div key={element}>
                                    <small>0{index + 1}</small>
                                    <strong>{element}</strong>
                                </div>
                            ))}
                        </div>

                        <div className="ladder full-ladder">
                            {visibleSteps.map((step, index) => {
                                const stairPosition = index % 18;
                                const offset =
                                    ((stairPosition <= 9
                                        ? stairPosition
                                        : 18 - stairPosition) /
                                        9) *
                                    35;
                                const style = {
                                    "--step-offset": `${offset}vw`,
                                } as CSSProperties;
                                const isTime =
                                    recipeOutputs(step).some(
                                        (output) =>
                                            normalize(output) ===
                                            normalize("Время"),
                                    );
                                const isSequentiallyCompleted =
                                    index < completedSteps;
                                const isManuallyOpened = recipeOutputs(
                                    step,
                                ).every((output) =>
                                    manuallyOpenedKeys.has(normalize(output)),
                                );
                                const isCompleted =
                                    isSequentiallyCompleted || isManuallyOpened;
                                const isCurrent =
                                    index === completedSteps &&
                                    !isManuallyOpened;

                                return (
                                    <div key={step.id}>
                                        <article
                                            id={`route-step-${index}`}
                                            className={`recipe-step ${isTime ? "is-final time-unlock" : ""} ${isCompleted ? "is-completed" : ""} ${isCurrent ? "is-current" : ""}`}
                                            style={style}
                                        >
                                            <div className="step-marker">
                                                <span>
                                                    {isCompleted
                                                        ? "✓"
                                                        : isTime
                                                          ? "✦"
                                                          : String(
                                                                index + 1,
                                                            ).padStart(3, "0")}
                                                </span>
                                            </div>
                                            <div className="recipe-card">
                                                <div className="card-meta">
                                                    <span>
                                                        {isTime
                                                            ? "ВРЕМЯ СОЗДАНО"
                                                            : isManuallyOpened &&
                                                                !isSequentiallyCompleted
                                                              ? `НАЙДЕНО В ПОИСКЕ · ${activeProfile?.name}`
                                                              : step.isNewElement
                                                                ? `НОВЫЙ ЭЛЕМЕНТ · ${step.unlockedCount}`
                                                                : "АЛЬТЕРНАТИВНЫЙ РЕЦЕПТ"}
                                                    </span>
                                                    <div className="card-actions">
                                                        <small>
                                                            #
                                                            {String(
                                                                step.number,
                                                            ).padStart(3, "0")}
                                                        </small>
                                                        <button
                                                            className="step-check"
                                                            type="button"
                                                            onClick={() => {
                                                                if (
                                                                    isManuallyOpened &&
                                                                    !isSequentiallyCompleted
                                                                ) {
                                                                    toggleOpenedRecipe(
                                                                        step,
                                                                    );
                                                                } else {
                                                                    setStepCompleted(
                                                                        index,
                                                                    );
                                                                }
                                                            }}
                                                            aria-label={
                                                                isManuallyOpened &&
                                                                !isSequentiallyCompleted
                                                                    ? `Снять отметку с элемента ${step.result}`
                                                                    : isCompleted
                                                                      ? `Вернуться к шагу ${index + 1}`
                                                                      : `Отметить шаг ${index + 1} выполненным`
                                                            }
                                                        >
                                                            {isManuallyOpened &&
                                                            !isSequentiallyCompleted
                                                                ? "✓ Найдено в поиске"
                                                                : isCompleted
                                                                  ? "✓ Выполнено"
                                                                  : "Отметить готовым"}
                                                        </button>
                                                    </div>
                                                </div>

                                                <div className="formula">
                                                        <span className="ingredient-chip">
                                                            {
                                                                step
                                                                    .ingredients[0]
                                                            }
                                                        </span>
                                                        <span className="operator">
                                                            +
                                                        </span>
                                                        <span className="ingredient-chip">
                                                            {
                                                                step
                                                                    .ingredients[1]
                                                            }
                                                        </span>
                                                        <span className="operator equals">
                                                            =
                                                        </span>
                                                        <strong>
                                                            {step.result}
                                                        </strong>
                                                </div>
                                            </div>
                                        </article>

                                        {view === "all" &&
                                            index ===
                                                walkthrough.timeStepIndex && (
                                                <div className="phase-divider">
                                                    <span>✦</span>
                                                    <div>
                                                        <small>ЭТАП II</small>
                                                        <strong>
                                                            Время уже создано —
                                                            продолжаем путь
                                                        </strong>
                                                    </div>
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
                                <small>
                                    {view === "time"
                                        ? "ПЕРВАЯ ЦЕЛЬ ДОСТИГНУТА"
                                        : "СПРАВОЧНИК ЗАВЕРШЁН"}
                                </small>
                                <strong>
                                    {view === "time"
                                        ? "Время создано!"
                                        : "Все рецепты открыты!"}
                                </strong>
                            </div>
                            <span className="finish-spark">✦</span>
                        </div>

                        {walkthrough.unresolvedRecipes > 0 && (
                            <p className="route-warning">
                                Не удалось расположить рецептов:{" "}
                                {walkthrough.unresolvedRecipes}
                            </p>
                        )}
                    </div>
                )}
            </section>

            <footer>
                <span>✦</span>
                <p>Быстро, просто, без нервов, методично</p>
                <span>✦</span>
            </footer>

            {profileCreatorOpen && (
                <div
                    className="profile-modal"
                    role="presentation"
                    onMouseDown={() => setProfileCreatorOpen(false)}
                >
                    <form
                        className="profile-dialog"
                        onSubmit={(event) => {
                            event.preventDefault();
                            createProfile();
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                    >
                        <button
                            className="dialog-close"
                            type="button"
                            onClick={() => setProfileCreatorOpen(false)}
                            aria-label="Закрыть"
                        >
                            ×
                        </button>
                        <span className="dialog-icon">
                            <FlaskIcon />
                        </span>
                        <small>НОВАЯ УЧЁТНАЯ ЗАПИСЬ</small>
                        <h2>Кто отправляется в путь?</h2>
                        <p>
                            У каждого персонажа будет отдельный сохранённый
                            прогресс.
                        </p>
                        <label>
                            <span>Имя персонажа</span>
                            <input
                                value={newProfileName}
                                onChange={(event) =>
                                    setNewProfileName(event.target.value)
                                }
                                placeholder="Имя персонажа"
                                maxLength={32}
                                autoFocus
                            />
                        </label>
                        <button
                            className="create-profile-button"
                            type="submit"
                            disabled={!newProfileName.trim()}
                        >
                            Создать персонажа
                        </button>
                    </form>
                </div>
            )}
        </main>
    );
}
