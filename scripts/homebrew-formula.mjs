import { readFile } from "node:fs/promises";

const [tag, checksums] = process.argv.slice(2);
if (!/^v\d+\.\d+\.\d+$/.test(tag || "") || !checksums)
  throw new Error("Usage: node scripts/homebrew-formula.mjs vX.Y.Z SHA256SUMS");
const hashes = new Map();
for (const line of (await readFile(checksums, "utf8")).trim().split(/\r?\n/)) {
  const match = line.match(/^([a-f0-9]{64})\s+\*?(awsl-webadb-(linux|macos)-(amd64|arm64))$/);
  if (!match || hashes.has(match[2])) throw new Error("Invalid or duplicate release checksum");
  hashes.set(match[2], match[1]);
}
for (const platform of ["macos", "linux"])
  for (const arch of ["arm64", "amd64"])
    if (!hashes.has(`awsl-webadb-${platform}-${arch}`)) throw new Error("Missing release checksum");
const platform = (os) => `  on_${os === "macos" ? "macos" : "linux"} do
    on_arm do
      url "https://github.com/awsl-project/awsl-webadb/releases/download/v#{version}/awsl-webadb-${os}-arm64", using: :nounzip
      sha256 "${hashes.get(`awsl-webadb-${os}-arm64`)}"
    end

    on_intel do
      url "https://github.com/awsl-project/awsl-webadb/releases/download/v#{version}/awsl-webadb-${os}-amd64", using: :nounzip
      sha256 "${hashes.get(`awsl-webadb-${os}-amd64`)}"
    end
  end`;
console.log(`class AwslWebadb < Formula
  desc "Android app control, shared web sessions and background camera streaming"
  homepage "https://github.com/awsl-project/awsl-webadb"
  version "${tag.slice(1)}"

${platform("macos")}

${platform("linux")}

  depends_on "ffmpeg"

  def install
    os = OS.mac? ? "macos" : "linux"
    arch = Hardware::CPU.arm? ? "arm64" : "amd64"
    bin.install "awsl-webadb-#{os}-#{arch}" => "awsl-webadb"
    (bin/"awsl-webadb").chmod 0755
  end

  def caveats
    <<~EOS
      Requires an ADB server. Install Android Platform Tools separately:
        macOS: brew install --cask android-platform-tools
        Linux: install adb using your distribution's package manager.
      Start ADB with: adb start-server
      Run the service with: awsl-webadb serve
      Or use: brew services start awsl-webadb
      Web UI: http://127.0.0.1:3000
    EOS
  end

  service do
    run [opt_bin/"awsl-webadb", "serve", "--ffmpeg", Formula["ffmpeg"].opt_bin/"ffmpeg"]
    environment_variables PATH: std_service_path_env
    keep_alive true
    log_path var/"log/awsl-webadb.log"
    error_log_path var/"log/awsl-webadb.log"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/awsl-webadb --version").strip
  end
end`);
