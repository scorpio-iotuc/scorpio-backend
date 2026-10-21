// Both job entrypoints use the shared coordinator so scheduled work stays queued
// while another job is running, even when several containers are started.
import "../main";
