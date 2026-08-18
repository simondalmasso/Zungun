# Shadow of the reliability defect specified in NousResearch/hermes-agent #13566.
# The scheduled result is persisted, but delivery timeout becomes a terminal failure and no retry queue consumes last_delivery_error.

def deliver_result(job, output):
    try:
        telegram_send(output, timeout=60)
        job["last_delivery_error"] = None
    except TimeoutError:
        job["last_delivery_error"] = "timed out"
        raise RuntimeError("FAILED delivery")

def tick(job):
    output = run_job(job)
    save_job_output(job, output)
    deliver_result(job, output)

def telegram_send(output, timeout):
    pass

def run_job(job):
    return "result"

def save_job_output(job, output):
    pass
