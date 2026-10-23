class AwslWebadb < Formula
  desc "Android app control, shared web sessions and background camera streaming"
  homepage "https://github.com/awsl-project/awsl-webadb"
  version "0.5.4"

  on_macos do
    on_arm do
      url "https://github.com/awsl-project/awsl-webadb/releases/download/v#{version}/awsl-webadb-macos-arm64", using: :nounzip
      sha256 "36995ac71c9c7fc476655dd2028f5ba15604a300d07852912eeaac482d8e3e06"
    end

    on_intel do
      url "https://github.com/awsl-project/awsl-webadb/releases/download/v#{version}/awsl-webadb-macos-amd64", using: :nounzip
      sha256 "631085a7cd4e076f1caa81317aca3836a287e8a7f1c281b76a6a14473f2c7636"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/awsl-project/awsl-webadb/releases/download/v#{version}/awsl-webadb-linux-arm64", using: :nounzip
      sha256 "756e895bb83f3fa39e029543ea80ee662533c8ac2e99c570cfeb820f3f4a4a47"
    end

    on_intel do
      url "https://github.com/awsl-project/awsl-webadb/releases/download/v#{version}/awsl-webadb-linux-amd64", using: :nounzip
      sha256 "f37591876292f23cb4c15d45123acd47587ca7637b20871009b5ac9f1aa79b2d"
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
