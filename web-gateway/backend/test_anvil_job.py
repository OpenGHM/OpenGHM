"""
Anvil + slurmly 연결 스모크 테스트.

FastAPI 앱 없이 독립 실행:
  cd backend
  python test_anvil_job.py

단계:
  1. slurmly client 연결 (purdue_anvil preset)
  2. 짧은 echo 잡 제출
  3. 상태 폴링 (terminal 까지 대기)
  4. stdout tail 출력
  5. remote 작업 디렉터리 정리
"""

from __future__ import annotations

import asyncio
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from slurmly import JobSpec, SlurmSSHClient, get_preset
from slurmly.polling import is_terminal


HOST = os.getenv("ANVIL_SSH_HOST", "anvil.rcac.purdue.edu")
PORT = int(os.getenv("ANVIL_SSH_PORT", "22"))
USER = os.getenv("ANVIL_SSH_USERNAME", "")
KEY_PATH = os.path.expanduser(os.getenv("ANVIL_SSH_KEY_PATH", ""))
KEY_CONTENT = os.getenv("ANVIL_SSH_KEY_CONTENT", "")
ACCOUNT = os.getenv("ANVIL_ACCOUNT", "")
PARTITION = os.getenv("ANVIL_PARTITION", "shared")
QOS = os.getenv("ANVIL_QOS", "cpu")
EXEC_PROFILE = os.getenv("ANVIL_EXECUTION_PROFILE", "anvil_cpu_modules")
REMOTE_BASE_DIR = os.getenv(
    "ANVIL_REMOTE_BASE_DIR", "/anvil/scratch/{username}/openghm"
).replace("{username}", USER)


GREEN, YELLOW, RED, CYAN, RESET, BOLD = (
    "\033[92m", "\033[93m", "\033[91m", "\033[96m", "\033[0m", "\033[1m"
)

def ok(msg):     print(f"{GREEN}  ✓ {msg}{RESET}")
def warn(msg):   print(f"{YELLOW}  ! {msg}{RESET}")
def fail(msg):   print(f"{RED}  ✗ {msg}{RESET}")
def info(msg):   print(f"{CYAN}  → {msg}{RESET}")
def header(msg): print(f"\n{BOLD}{msg}{RESET}")


def preflight() -> bool:
    header("[ 0 ] 환경 변수 확인")
    key_source = "content" if KEY_CONTENT else f"path={KEY_PATH}"
    info(f"host={HOST}  user={USER}  key={key_source}")
    info(f"remote_base_dir={REMOTE_BASE_DIR}")
    info(f"account={ACCOUNT}  partition={PARTITION}  qos={QOS}")

    bad = False
    if not USER:
        fail("ANVIL_SSH_USERNAME 미설정"); bad = True
    if not KEY_CONTENT and (not KEY_PATH or not Path(KEY_PATH).exists()):
        fail(f"ANVIL_SSH_KEY_CONTENT 또는 유효한 ANVIL_SSH_KEY_PATH 필요"); bad = True
    if not ACCOUNT:
        fail("ANVIL_ACCOUNT 미설정"); bad = True
    return not bad


async def run_smoke_test():
    if not preflight():
        sys.exit(1)

    preset = get_preset("purdue_anvil")

    header("[ 1 ] slurmly client 연결")
    async with SlurmSSHClient.connect(
        host=HOST,
        port=PORT,
        username=USER,
        key_content=KEY_CONTENT or None,
        key_path=KEY_PATH or None,
        remote_base_dir=REMOTE_BASE_DIR,
        cluster_profile=preset.cluster_profile,
        execution_profiles=preset.execution_profiles,
        account=ACCOUNT,
        max_concurrent_commands=4,
    ) as client:
        ok("연결 성공")

        header("[ 2 ] 잡 제출")
        spec = JobSpec(
            name="openghm-smoke",
            command_template=(
                'echo "ok from $HOSTNAME at $(date -Iseconds)"; '
                'echo "user=$(whoami)"; '
                'lscpu | grep "^Model name" || true'
            ),
            partition=PARTITION,
            qos=QOS,
            cpus_per_task=1,
            memory="256M",
            time_limit="00:01:00",
            execution_profile=EXEC_PROFILE,
        )
        submitted = await client.submit(spec)
        ok(f"slurm_job_id={submitted.slurm_job_id}")
        info(f"remote_job_dir={submitted.remote_job_dir}")

        header("[ 3 ] 상태 폴링 (최대 5분)")
        deadline = time.time() + 300
        last = None
        while time.time() < deadline:
            info_obj = await client.get_job(
                submitted.slurm_job_id,
                submitted_at=submitted.submitted_at,
            )
            if info_obj.lifecycle != last:
                info(f"lifecycle={info_obj.lifecycle} raw={info_obj.raw_state}")
                last = info_obj.lifecycle
            if is_terminal(info_obj):
                break
            await asyncio.sleep(5)
        else:
            warn("5분 내 종료되지 않음 — 수동 확인 필요")
            return

        if last == "succeeded":
            ok("잡 정상 완료")
        else:
            fail(f"잡 종료 상태: {last}")

        header("[ 4 ] stdout tail")
        chunk = await client.tail_stdout(submitted, lines=50)
        content = getattr(chunk, "content", "") or ""
        if content.strip():
            for line in content.strip().splitlines():
                print(f"  {line}")
            ok("stdout 읽기 성공")
        else:
            warn("stdout 비어있음")

        header("[ 5 ] 정리")
        await client.cleanup_remote_job_dir(submitted)
        ok("remote 디렉터리 삭제")

    header("[ 완료 ]")
    print(f"{GREEN}{BOLD}  모든 테스트 완료!{RESET}\n")


if __name__ == "__main__":
    asyncio.run(run_smoke_test())
