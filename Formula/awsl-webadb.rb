class AwslWebadb < Formula
  desc "Android app control, shared web sessions and background camera streaming"
  homepage "https://github.com/awsl-project/awsl-webadb"
  version "0.5.6"

  on_macos do
    on_arm do
      url "https://github.com/awsl-project/awsl-webadb/releases/download/v#{version}/awsl-webadb-macos-arm64", using: :nounzip
      sha256 "53717f2bf55a21e42556dc7ddfb7ea4c44b055231d1b672bf01b7a222c437b6f"
    end

    on_intel do
      url "https://github.com/awsl-project/awsl-webadb/releases/download/v#{version}/awsl-webadb-macos-amd64", using: :nounzip
      sha256 "2507f3248a11310d55f15101451aa87f0bec123db0a936715b0b115b1ba71271"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/awsl-project/awsl-webadb/releases/download/v#{version}/awsl-webadb-linux-arm64", using: :nounzip
      sha256 "e4cbfbae17d366b02829fba4c0b154ce1558b595203a95afde72849a4db7a8ae"
    end

    on_intel do
      url "https://github.com/awsl-project/awsl-webadb/releases/download/v#{version}/awsl-webadb-linux-amd64", using: :nounzip
      sha256 "81f3df6a87d803b7f94f775756551261f90d62b419497fa07953d5cd442699c8"
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
