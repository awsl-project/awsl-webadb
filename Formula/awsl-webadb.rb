class AwslWebadb < Formula
  desc "Android app control, shared web sessions and background camera streaming"
  homepage "https://github.com/awsl-project/awsl-webadb"
  version "0.5.3"

  on_macos do
    on_arm do
      url "https://github.com/awsl-project/awsl-webadb/releases/download/v#{version}/awsl-webadb-macos-arm64", using: :nounzip
      sha256 "54441fe2872b4dd46a7a0e15f164806402d8ff9466c820216b59f5033e7d1088"
    end

    on_intel do
      url "https://github.com/awsl-project/awsl-webadb/releases/download/v#{version}/awsl-webadb-macos-amd64", using: :nounzip
      sha256 "e8054eb5418dbb92448fcbc77d6df597d83511d183047c73a0fc57df89098201"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/awsl-project/awsl-webadb/releases/download/v#{version}/awsl-webadb-linux-arm64", using: :nounzip
      sha256 "b24273a7735ac21df5a6a0efc5e5a73b06f2c00f5f1a7357d9757d4434486b91"
    end

    on_intel do
      url "https://github.com/awsl-project/awsl-webadb/releases/download/v#{version}/awsl-webadb-linux-amd64", using: :nounzip
      sha256 "1b07d6afa41175344b726df9894802fe6a6e139a1cc2f0133bb3cdbe2ace8e1b"
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
