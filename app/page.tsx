import { readFile } from "node:fs/promises";
import path from "node:path";
import RecipeExplorer, { type Recipe } from "./recipe-explorer";

function parseRecipes(source: string): Recipe[] {
  const seen = new Set<string>();
  const normalize = (value: string) =>
    value.toLocaleLowerCase("ru-RU").replaceAll("ё", "е").trim();

  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap<Recipe>((line, index) => {
      const recipe = line.match(/^\s*(\d+)\.\s*(.+?)\s*\+\s*(.+?)\s*=\s*(.+?)\s*$/);
      if (!recipe) return [];

      const result = recipe[4].trim();
      const ingredients = [recipe[2].trim(), recipe[3].trim()] as [string, string];
      const outputs = result.split(/\s*\+\s*/).map((output) => output.trim());
      const signature = `${ingredients.map(normalize).sort().join("+")}=${outputs
        .map(normalize)
        .sort()
        .join("+")}`;
      if (seen.has(signature)) return [];
      seen.add(signature);

      return [
        {
          id: `recipe-${index}`,
          number: Number(recipe[1]),
          ingredients,
          result,
          outputs,
        },
      ];
    });
}

export default async function Home() {
  const source = await readFile(path.join(process.cwd(), "app", "data.txt"), "utf8");
  const recipes = parseRecipes(source);

  return <RecipeExplorer recipes={recipes} />;
}
