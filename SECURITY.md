# Security

GitNut daemons can read and change git repositories, so we take reports seriously.

Please report vulnerabilities privately through
[GitHub security advisories](https://github.com/flyingart/gitnut/security/advisories/new), not in public
issues. You will get an answer within a few days. Fixes ship as a new release; `gitnut update`
installs it.

Defaults worth knowing: the daemon listens on 127.0.0.1 with auth off. Before you expose it to other
machines, turn on the access token (`gitnut config set auth.enabled true`).
