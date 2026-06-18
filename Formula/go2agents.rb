class Go2agents < Formula
  desc "Dashboard for every Claude Code / Codex agent running on your machine"
  homepage "https://github.com/fihaaade/Go-to-Agents"
  license "MIT"
  url "https://github.com/fihaaade/Go-to-Agents/archive/refs/tags/v0.1.0.tar.gz"
  sha256 "eee455fd0d7a8f7854cf2cc8b3f10e8ed3aa869a41f5303477619dac571ad272"
  head "https://github.com/fihaaade/Go-to-Agents.git", branch: "main"

  depends_on "bun"
  depends_on "tmux"
  depends_on "ripgrep"

  def install
    system Formula["bun"].opt_bin/"bun", "install", "--production"
    libexec.install Dir["*"]
    (bin/"go2agents").write <<~SH
      #!/bin/bash
      exec "#{Formula["bun"].opt_bin}/bun" run "#{libexec}/src/cli.tsx" "$@"
    SH
    (bin/"gta").write <<~SH
      #!/bin/bash
      exec "#{Formula["bun"].opt_bin}/bun" run "#{libexec}/src/cli.tsx" "$@"
    SH
  end

  test do
    output = shell_output("#{bin}/go2agents --json 2>&1")
    assert_match(/^\[/, output.strip)
  end
end
