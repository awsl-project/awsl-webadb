class AwslWebadb < Formula
  desc "Android app control, shared web sessions and background camera streaming"
  homepage "https://github.com/awsl-project/awsl-webadb"
  version "0.5.0"

  on_macos do
    on_arm do
      url "https://github.com/awsl-project/awsl-webadb/releases/download/v#{version}/awsl-webadb-macos-arm64", using: :nounzip
      sha256 "1b88508925662091347690d36fd47fd8bf52d65213e628623eb59c8a3b393109"
    end

    on_intel do
      url "https://github.com/awsl-project/awsl-webadb/releases/download/v#{version}/awsl-webadb-macos-amd64", using: :nounzip
      sha256 "e4730021349acdd6c421639b40621834164c250c9e5288f64860489a970f39fe"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/awsl-project/awsl-webadb/releases/download/v#{version}/awsl-webadb-linux-arm64", using: :nounzip
      sha256 "08cd2ae4948a82b94a071ece482eb5e1a3e5b01f2241611bd523b4ba37be2b7b"
    end

    on_intel do
      url "https://github.com/awsl-project/awsl-webadb/releases/download/v#{version}/awsl-webadb-linux-amd64", using: :nounzip
      sha256 "6a9431962906f297358e510d2723c0de160dc63c7b590527d5084e5ad235bccb"
    end
  end

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
end
