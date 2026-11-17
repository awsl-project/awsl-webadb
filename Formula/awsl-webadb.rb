class AwslWebadb < Formula
  desc "Android app control, shared web sessions and background camera streaming"
  homepage "https://github.com/awsl-project/awsl-webadb"
  version "0.5.7"

  on_macos do
    on_arm do
      url "https://github.com/awsl-project/awsl-webadb/releases/download/v#{version}/awsl-webadb-macos-arm64", using: :nounzip
      sha256 "40cbfba18ca964cfa2d3fa987491485afb6ac35a0146ac3eb08eccedb4b0e70e"
    end

    on_intel do
      url "https://github.com/awsl-project/awsl-webadb/releases/download/v#{version}/awsl-webadb-macos-amd64", using: :nounzip
      sha256 "3a37ac98cc40af6a138648bf3488c9ff676844ad35de754c0ebbe56171fa1c44"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/awsl-project/awsl-webadb/releases/download/v#{version}/awsl-webadb-linux-arm64", using: :nounzip
      sha256 "e4acaba027f7fe259b619a0078eda327ca422a0775a400ec7e9b69cb3d3fa623"
    end

    on_intel do
      url "https://github.com/awsl-project/awsl-webadb/releases/download/v#{version}/awsl-webadb-linux-amd64", using: :nounzip
      sha256 "3b92ba09d94fb90e0df89a62c3f6f35e8f225b453bd80b7a3a01c58451b57a20"
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
