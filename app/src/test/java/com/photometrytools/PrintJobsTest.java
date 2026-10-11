package com.photometrytools;

import org.junit.Test;

import java.util.TimeZone;

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

    @Test
    public void reportPageUsesNumberPathOrTimestampNotSiteTitle() {
        TimeZone utc = TimeZone.getTimeZone("UTC");
        long noon = 1_778_000_000_000L;
        assertEquals("ServiceReport-SR-12",
                PrintJobs.jobName("RepairPlanet", "SR-12", "/reports/new", noon, utc));
        assertEquals("ServiceReport-1042",
                PrintJobs.jobName("RepairPlanet", "", "/reports/1042", noon, utc));
        assertEquals("ServiceReport-" + PrintJobs.stamp(noon, utc),
                PrintJobs.jobName("RepairPlanet", "", "/reports/new", noon, utc));
        assertEquals("ServiceReport-" + PrintJobs.stamp(noon, utc),
                PrintJobs.jobName("Total Service Pro", "  ", "/reports/new", noon, utc));
        assertEquals("ServiceReport-9",
                PrintJobs.jobName("Informe de servicio 9", null, "/reports/new", noon, utc));
        assertEquals("ServiceReport-9",
                PrintJobs.jobName("דוח שירות 9", null, null, noon, utc));
        assertEquals("ServiceReport-3",
                PrintJobs.jobName("Rapport d’intervention 3", null, null, noon, utc));
        assertEquals("Document",
                PrintJobs.jobName("RepairPlanet", null, "/invoices/new", noon, utc));
    }
}
