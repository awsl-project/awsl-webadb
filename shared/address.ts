export function parseDeviceAddress(value: string) {
  const address = value.trim();
  const match = address.match(
    /^(\[[0-9a-fA-F:.]+\]|[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?):([0-9]{1,5})$/,
  );
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) return null;
  return { address, host: match[1], port: Number(match[2]) };
}
