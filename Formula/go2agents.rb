class Go2agents < Formula
  desc "Dashboard for every Claude Code / Codex agent running on your machine"
  homepage "https://github.com/fihaaade/Go-to-Agents"
  license "MIT"
  head "https://github.com/fihaaade/Go-to-Agents.git", branch: "main"

  # For tagged releases, fill these in (sha256 of the release tarball):
  # url "https://github.com/fihaaade/Go-to-Agents/archive/refs/tags/v0.1.0.tar.gz"
  # sha256 "REPLACE_ME"

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
