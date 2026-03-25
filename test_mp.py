import multiprocessing as mp
import time

STATE = {"is_processing": False}

def worker(estado):
    try:
        estado["is_processing"] = True
        time.sleep(1)
        print("Worker success!")
    except Exception as e:
        print(f"Worker Error: {e}")

if __name__ == "__main__":
    mp.set_start_method('spawn', force=True)
    man = mp.Manager()
    STATE = man.dict(STATE)
    p = mp.Process(target=worker, args=(STATE,))
    p.start()
    p.join()
    print("Final state:", dict(STATE))
