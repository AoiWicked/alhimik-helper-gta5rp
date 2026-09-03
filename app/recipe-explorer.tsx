"use client";

import { type CSSProperties, useMemo, useState, useSyncExternalStore } from "react";

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

function HourglassIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3h12M6 21h12M7 3c0 4 1.8 6.4 5 9-3.2 2.6-5 5-5 9M17 3c0 4-1.8 6.4-5 9 3.2 2.6 5 5 5 9" />
    </svg>
  );
}

export default function RecipeExplorer({ recipes }: { recipes: Recipe[] }) {
  const [view, setView] = useState<"time" | "all">("time");
  const [profileCreatorOpen, setProfileCreatorOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const walkthrough = useMemo(() => buildWalkthrough(recipes), [recipes]);
  const timeSteps = useMemo(
    () => walkthrough.steps.slice(0, walkthrough.timeStepIndex + 1),
    [walkthrough],
  );
  const visibleSteps = view === "time" ? timeSteps : walkthrough.steps;
  const profilesSnapshot = useSyncExternalStore(subscribeToProfiles, getProfilesSnapshot, () => "");
  const profileStore = useMemo(() => parseProfiles(profilesSnapshot), [profilesSnapshot]);
  const activeProfile = profileStore.profiles.find(
    (profile) => profile.id === profileStore.activeProfileId,
  );
  const completedSteps = Math.min(activeProfile?.completedSteps ?? 0, walkthrough.steps.length);
  const visibleCompleted = Math.min(completedSteps, visibleSteps.length);
  const progressPercent = visibleSteps.length
    ? Math.round((visibleCompleted / visibleSteps.length) * 100)
    : 0;

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
    setView("time");
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

  return (
    <main className="app-shell">
      <div className="paper-grain" aria-hidden="true" />

      <header className="hero walkthrough-hero">
        <div className="profile-manager">
          <span className="profile-label">ПЕРСОНАЖ</span>
          {activeProfile ? (
            <>
              <select
                value={activeProfile.id}
                onChange={(event) => switchProfile(event.target.value)}
                aria-label="Текущий персонаж"
              >
                {profileStore.profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.name}</option>
                ))}
              </select>
              <button className="new-profile-button" type="button" onClick={() => setProfileCreatorOpen(true)}>+ Новый</button>
              <button className="delete-profile-button" type="button" onClick={deleteActiveProfile} aria-label={`Удалить персонажа ${activeProfile.name}`}>×</button>
            </>
          ) : (
            <button className="new-profile-button is-primary" type="button" onClick={() => setProfileCreatorOpen(true)}>+ Создать персонажа</button>
          )}
        </div>

        <div className="brand-mark">
          <span className="brand-icon"><FlaskIcon /></span>
          <span>АЛХИМИЧЕСКИЙ СПРАВОЧНИК</span>
        </div>
        <h1>От четырёх стихий<br /><em>ко всем открытиям</em></h1>
        <p className="hero-copy">
          Готовая последовательность всех комбинаций. Выполняй рецепты сверху вниз —
          ни один элемент не понадобится раньше, чем будет открыт.
        </p>

        <div className="route-switch" role="group" aria-label="Выбрать длину маршрута">
          <button
            className={view === "time" ? "is-active" : ""}
            type="button"
            onClick={() => setView("time")}
          >
            <HourglassIcon />
            <span><small>ЭТАП I</small>До открытия Времени</span>
            <strong>{timeSteps.length} ступеней</strong>
          </button>
          <button
            className={view === "all" ? "is-active" : ""}
            type="button"
            onClick={() => setView("all")}
          >
            <FlaskIcon />
            <span><small>ПОЛНЫЙ ПУТЬ</small>Все рецепты</span>
            <strong>{recipes.length} ступеней</strong>
          </button>
        </div>

        <div className="stats" aria-label="Статистика маршрута">
          <span><strong>4</strong> начальные стихии</span>
          <i />
          <span><strong>{recipes.length}</strong> рецептов</span>
          <i />
          <span><strong>{walkthrough.totalElements}</strong> элементов</span>
        </div>
      </header>

      <section className="journey has-result">
        <div className="path-content">
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
                placeholder="Например, Алекс"
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
