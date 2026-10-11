package com.photometrytools;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

public class PrintJobsTest {
    @Test
    public void serviceReportTitleBecomesJobName() {
        assertEquals("ServiceReport-1042", PrintJobs.jobNameFromTitle("Service Report 1042"));
        assertEquals("ServiceReport-SR-12", PrintJobs.jobNameFromTitle("Service Report SR-12"));
        assertEquals("ServiceReport-1042", PrintJobs.jobNameFromTitle("Service Report - 1042"));
        assertEquals("ServiceReport", PrintJobs.jobNameFromTitle("Service Report"));
        assertEquals("ServiceReport-9", PrintJobs.jobNameFromTitle("  service report   9  "));
    }

    @Test
    public void emptyAndOtherTitles() {
        assertEquals("Document", PrintJobs.jobNameFromTitle(null));
        assertEquals("Document", PrintJobs.jobNameFromTitle(""));
        assertEquals("Document", PrintJobs.jobNameFromTitle("   "));
        assertEquals("Document", PrintJobs.jobNameFromTitle("about:blank"));
        assertEquals("New-Service-Report", PrintJobs.jobNameFromTitle("New Service Report"));
        assertEquals("Invoice-100", PrintJobs.jobNameFromTitle("Invoice/100"));
    }
}
