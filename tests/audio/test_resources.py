"""Resource preparation recovers from interrupted copies and shared-cache writers."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
import json
from pathlib import Path
from queue import Queue
import sys
import tempfile
from threading import Barrier, Event
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools" / "audio"))
import resources


class ResourcePreparation(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.directory = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.music = self.directory / "music" / "Inspired.mp3"
        self.stack.enter_context(patch.object(resources, "CACHE", self.directory))
        self.stack.enter_context(patch.object(resources, "MUSIC", self.music))

    def test_interrupted_local_music_copy_is_not_published_and_retry_succeeds(self):
        source = self.directory / "authored.mp3"
        source.write_bytes(b"complete authored music")

        def interrupted(source, destination):
            Path(destination).write_bytes(b"incomplete")
            raise OSError("interrupted copy")

        with patch.object(resources.shutil, "copyfile", side_effect=interrupted):
            with self.assertRaisesRegex(OSError, "interrupted"):
                resources.prepare_music(source)
        self.assertFalse(self.music.exists())
        self.assertEqual(list(self.music.parent.iterdir()), [])
        resources.prepare_music(source)
        self.assertEqual(self.music.read_bytes(), source.read_bytes())

    def test_receipt_writers_publish_complete_files_without_sharing_a_temporary(self):
        target = self.directory / "verified-models.json"
        barrier = Barrier(2)
        write = Path.write_text

        def simultaneous(path, *args, **kwargs):
            result = write(path, *args, **kwargs)
            barrier.wait(timeout=2)
            return result

        with patch.object(Path, "write_text", simultaneous), ThreadPoolExecutor(2) as pool:
            list(pool.map(lambda i: resources.atomic_json(target, {"writer": i}), range(2)))
        self.assertIn(json.loads(target.read_text()), [{"writer": 0}, {"writer": 1}])
        self.assertEqual(list(self.directory.glob("*.pending")), [])

    def test_concurrent_setup_waits_for_the_owner_and_recovers_after_failure(self):
        release = Event()
        second_entered = Event()
        attempts = Queue()
        entered = []
        flock = resources.fcntl.flock

        def observe_lock(*args):
            attempts.put(True)
            return flock(*args)

        def prepare(*args, **kwargs):
            entered.append(len(entered))
            if len(entered) == 1:
                if not release.wait(2):
                    raise TimeoutError("first setup was not released")
                raise RuntimeError("cancelled setup")
            second_entered.set()

        with patch.object(resources.fcntl, "flock", observe_lock), \
                patch.object(resources, "_setup", prepare), ThreadPoolExecutor(2) as pool:
            first = pool.submit(resources.setup)
            attempts.get(timeout=2)
            second = pool.submit(resources.setup)
            attempts.get(timeout=2)
            try:
                self.assertFalse(second_entered.wait(0.1))
            finally:
                release.set()
            with self.assertRaisesRegex(RuntimeError, "cancelled"):
                first.result(timeout=2)
            second.result(timeout=2)
        self.assertTrue(second_entered.is_set())
        self.assertEqual(entered, [0, 1])


if __name__ == "__main__":
    unittest.main()
