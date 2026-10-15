export const PACKAGE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+$/;
export const COMPONENT_PATTERN = /^[a-zA-Z][\w]*(?:\.[\w]+)+\/[\w.$]+$/;

export function parseLauncherApps(output: string, systemOutput: string) {
  const systemPackages = new Set(
    systemOutput
      .split(/\r?\n/)
      .map((line) => line.replace(/^package:/, "").trim()),
  );
  const components = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => COMPONENT_PATTERN.test(line));
  const seen = new Set<string>();
  return components.flatMap((component) => {
    const packageName = component.split("/")[0];
    if (seen.has(packageName)) return [];
    seen.add(packageName);
    let hash = 0;
    for (const character of packageName)
      hash = (hash * 31 + character.charCodeAt(0)) | 0;
    return [
      {
        packageName,
        component,
        name: packageName,
        icon: "apps",
        hue: Math.abs(hash) % 360,
        system: systemPackages.has(packageName),
      },
    ];
  });
}
