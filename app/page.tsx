import { readFile } from "node:fs/promises";
import path from "node:path";
import RecipeExplorer, { type Recipe } from "./recipe-explorer";

function parseRecipes(source: string): Recipe[] {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap<Recipe>((line, index) => {
      const recipe = line.match(/^\s*(\d+)\.\s*(.+?)\s*\+\s*(.+?)\s*=\s*(.+?)\s*$/);
      if (!recipe) return [];

      const result = recipe[4].trim();
      return [
        {
          id: `recipe-${index}`,
          number: Number(recipe[1]),
          ingredients: [recipe[2].trim(), recipe[3].trim()] as [string, string],
          result,
          outputs: result.split(/\s*\+\s*/).map((output) => output.trim()),
        },
      ];
    });
}

export default async function Home() {
  const source = await readFile(path.join(process.cwd(), "app", "data.txt"), "utf8");
  const recipes = parseRecipes(source);

  return <RecipeExplorer recipes={recipes} />;
}
