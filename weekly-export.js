/* ==============================================
   Venue Desk - Weekly Excel Export
   Friday to Thursday
   ============================================== */

const EXPORT_TZ = 'Asia/Kuala_Lumpur';
const EXPORT_DAY_MS = 86400000;

const EXPORT_DAYS = [
    '星期五',
    '星期六',
    '星期日',
    '星期一',
    '星期二',
    '星期三',
    '星期四'
];

/* Venue mapping based on the Excel template */

const EXPORT_GROUPS = [
    {
        title: '旧堂 OLD BUILDING',
        rooms: [
            {
                label: '停车场 (Car Park)',
                aliases: ['Car Park', '停车场']
            },
            {
                label: '中文图书馆 (Chi Library)',
                aliases: [
                    'Chinese Library',
                    'Chinese Library 华文图书馆',
                    'Chi Library',
                    'Library-Chinese',
                    '华文图书馆',
                    '中文图书馆'
                ]
            },
            {
                label: '英文图书馆 (Eng Library)',
                aliases: [
                    'Eng Library',
                    'Eng Library 英文图书馆',
                    'English Library',
                    'Library-English',
                    '英文图书馆'
                ]
            },
            {
                label: '副堂 (Function Hall)',
                aliases: [
                    'Function Hall',
                    'Function Hall 副堂',
                    '副堂'
                ]
            },
            {
                label: '食堂 (Canteen)',
                aliases: [
                    'Old Canteen',
                    'Old Canteen 旧楼食堂',
                    '旧楼食堂'
                ]
            },
            {
                label: '儿童音乐室 (Children Music Room) G04',
                aliases: [
                    'Children Music Room',
                    'Children Music Room G04',
                    'G04',
                    '儿童音乐室'
                ]
            },
            {
                label: '宣恩园地 (Graceland)',
                aliases: [
                    'Graceland',
                    'Graceland 宣恩园地',
                    '宣恩园地'
                ]
            },
            {
                label: '康乐室 (Children Play Room)',
                aliases: [
                    'Children Play Room',
                    '康乐室'
                ]
            },
            {
                label: '会议室 (Meeting Room)',
                aliases: [
                    'Meeting Room',
                    '会议室'
                ]
            },
            {
                label: '辅导室 (Counseling Room) F13',
                aliases: [
                    'Counseling Room',
                    'Counselling Room',
                    'F13',
                    '辅导室'
                ]
            },
            {
                label: '会客室',
                aliases: [
                    'Reception Room',
                    '会客室'
                ]
            },
            {
                label: 'Classroom F01',
                aliases: [
                    'Old F01',
                    'Old Building F01',
                    'Old Classroom F01'
                ]
            },
            {
                label: 'Classroom F03',
                aliases: ['F03', 'Classroom F03']
            },
            {
                label: 'Classroom F06',
                aliases: ['F06', 'Classroom F06']
            },
            {
                label: 'Classroom F07',
                aliases: ['F07', 'Classroom F07']
            },
            {
                label: 'Classroom F15',
                aliases: ['F15', 'Classroom F15']
            },
            {
                label: 'Classroom F16',
                aliases: ['F16', 'Classroom F16']
            },
            {
                label: '大堂 (Sanctuary Hall)',
                aliases: [
                    'Main Hall',
                    'Main Hall 大堂',
                    'Sanctuary Hall',
                    '大堂'
                ]
            }
        ]
    },
    {
        title: '新堂 NEW BUILDING',
        rooms: [
            {
                label: '保罗厅 (Paul Hall)',
                aliases: [
                    'Paul Hall',
                    'Paul Hall 保罗堂',
                    '保罗堂',
                    '保罗厅'
                ]
            },
            {
                label: '约翰厅 (John Hall)',
                aliases: [
                    'John Hall',
                    'John Hall 约翰堂',
                    '约翰堂',
                    '约翰厅'
                ]
            },
            {
                label: '彼得厅 (Peter Hall)',
                aliases: [
                    'Peter Hall',
                    'Peter Hall 彼得堂',
                    '彼得堂',
                    '彼得厅'
                ]
            },
            {
                label: 'VIP Room',
                aliases: ['VIP Room']
            },
            {
                label: '食堂 (Canteen)',
                aliases: [
                    'New Canteen',
                    'New Canteen 新楼食堂',
                    '新楼食堂'
                ]
            },
            {
                label: '顶楼 (Rooftop)',
                aliases: ['Rooftop', '顶楼']
            },
            {
                label: 'Classroom C07',
                aliases: ['C07', 'Classroom C07']
            },
            {
                label: 'Classroom F01',
                aliases: [
                    'New F01',
                    'New Building F01',
                    'New Classroom F01'
                ]
            },
            {
                label: 'Classroom E01',
                aliases: ['E01', 'Classroom E01']
            }
        ]
    }
];


/* ==============================================
   Date helpers
   ============================================== */

function exportDateKey(date) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: EXPORT_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);

    const get = type =>
        parts.find(p => p.type === type).value;

    return `${get('year')}-${get('month')}-${get('day')}`;
}


function exportAddDays(date, days) {
    const d = new Date(date + 'T00:00:00Z');

    d.setUTCDate(d.getUTCDate() + days);

    return d.toISOString().slice(0, 10);
}


function getExportWeek(selectedDate) {
    if (!validBlockDate(selectedDate)) {
        throw new Error('Please select a valid date.');
    }

    const date = new Date(
        selectedDate + 'T00:00:00Z'
    );

    // Friday = 5
    const daysSinceFriday =
        (date.getUTCDay() - 5 + 7) % 7;

    const friday = exportAddDays(
        selectedDate,
        -daysSinceFriday
    );

    return Array.from(
        { length: 7 },
        (_, i) => exportAddDays(friday, i)
    );
}


function exportDisplayDate(date) {
    return new Date(
        date + 'T00:00:00Z'
    ).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC'
    });
}


function exportTime(date) {
    return new Intl.DateTimeFormat('en-US', {
        timeZone: EXPORT_TZ,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    }).format(date);
}


function exportDayStart(date) {
    return new Date(
        date + 'T00:00:00+08:00'
    ).getTime();
}


/* ==============================================
   Venue mapping
   ============================================== */

function exportVenueKey(value) {
    return String(value || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\s()[\]（）_\-]/g, '');
}


function findExportRoom(groups, venue) {
    const key = exportVenueKey(venue);

    const matches = groups
        .flatMap(group => group.rooms)
        .filter(room =>
            [room.label, ...room.aliases]
                .some(alias =>
                    exportVenueKey(alias) === key
                )
        );

    // Do not guess when two buildings
    // have the same room name.
    return matches.length === 1
        ? matches[0]
        : null;
}


function buildExportGroups(venueList) {
    const groups = EXPORT_GROUPS.map(group => ({
        title: group.title,
        rooms: group.rooms.map(room => ({
            ...room,
            aliases: [...room.aliases],
            bookings: Array.from(
                { length: 7 }, () => []
            )
        }))
    }));

    const otherGroup = {
        title: '其他场地 OTHER VENUES',
        rooms: []
    };

    const seen = new Set();

    for (const venue of venueList) {
        const name = String(
            venue || 'Unspecified venue'
        ).trim() || 'Unspecified venue';

        const key = exportVenueKey(name);

        if (seen.has(key)) continue;

        seen.add(key);

        if (!findExportRoom(groups, name)) {
            otherGroup.rooms.push({
                label: name,
                aliases: [name],
                bookings: Array.from(
                    { length: 7 }, () => []
                )
            });
        }
    }

    if (otherGroup.rooms.length) {
        groups.push(otherGroup);
    }

    return groups;
}


/* ==============================================
   Booking display
   ============================================== */

function exportBookingText(
    booking,
    day,
    includeNotes
) {
    const dayStart = exportDayStart(day);
    const dayEnd = dayStart + EXPORT_DAY_MS;

    const start = Math.max(
        booking.start.getTime(),
        dayStart
    );

    const end = Math.min(
        booking.end.getTime(),
        dayEnd
    );

    let time;

    if (start === dayStart && end === dayEnd) {
        time = 'All day';
    } else {
        const startText = exportTime(
            new Date(start)
        );

        const endText = end === dayEnd
            ? '12:00 AM (next day)'
            : exportTime(new Date(end));

        time = `${startText} - ${endText}`;
    }

    let text = `${booking.title}\n${time}`;

    if (includeNotes && booking.notes.trim()) {
        text += `\n备注: ${booking.notes}`;
    }

    return text;
}


/* ==============================================
   Generate Excel workbook
   ============================================== */

async function generateWeeklyExcel(
    dates,
    bookings,
    venueList,
    includeNotes
) {
    if (!window.ExcelJS) {
        throw new Error(
            'ExcelJS could not be loaded.'
        );
    }

    const groups = buildExportGroups([
        ...venueList,
        ...bookings.map(b => b.venue)
    ]);

    // Group bookings by venue and date.
    for (const booking of bookings) {

        const venue = booking.venue ||
            'Unspecified venue';

        // Prefer an exact unmatched venue row.
        const otherGroup = groups.find(
            g => g.title === '其他场地 OTHER VENUES'
        );

        const room = otherGroup?.rooms.find(
            r => exportVenueKey(r.label) ===
                exportVenueKey(venue)
        ) || findExportRoom(groups, venue);

        if (!room) {
            throw new Error(
                'Unable to map venue: ' + venue
            );
        }

        dates.forEach((date, index) => {
            const start = exportDayStart(date);
            const end = start + EXPORT_DAY_MS;

            if (
                booking.start.getTime() < end &&
                booking.end.getTime() > start
            ) {
                room.bookings[index].push(booking);
            }
        });
    }

    const workbook = new ExcelJS.Workbook();

    workbook.creator = 'Venue Desk';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Weekly', {
        views: [
            {
                state: 'frozen',
                xSplit: 1,
                ySplit: 2,
                showGridLines: false
            }
        ],
        pageSetup: {
            paperSize: 9,
            orientation: 'landscape',
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0,
            horizontalCentered: true
        }
    });

    const edge = {
        style: 'thin',
        color: { argb: 'FF000000' }
    };

    const border = {
        top: edge,
        bottom: edge,
        left: edge,
        right: edge
    };

    function styleCell(cell, options = {}) {
        cell.font = {
            name: options.font || 'Times New Roman',
            size: options.size || 18,
            bold: Boolean(options.bold),
            color: { argb: 'FF000000' }
        };

        cell.alignment = {
            horizontal: options.align || 'center',
            vertical: 'middle',
            wrapText: true
        };

        cell.border = border;
    }

    /* Column widths */

    sheet.getColumn(1).width = 50;

    for (let c = 2; c <= 8; c++) {
        sheet.getColumn(c).width = 27;
    }


    /* Title */

    sheet.mergeCells('A1:A2');

    const title = sheet.getCell('A1');

    title.value =
        'Room Reservation Record\n【WEEKLY】';

    styleCell(title, {
        size: 20,
        bold: true,
        align: 'left'
    });

    sheet.getRow(1).height = 36;
    sheet.getRow(2).height = 30;


    /* Weekday and date headings */

    dates.forEach((date, index) => {
        const dayCell = sheet.getCell(
            1, index + 2
        );

        dayCell.value = EXPORT_DAYS[index];

        styleCell(dayCell, {
            size: 20,
            bold: true,
            font: 'KaiTi'
        });

        const dateCell = sheet.getCell(
            2, index + 2
        );

        dateCell.value = new Date(
            date + 'T00:00:00Z'
        );

        dateCell.numFmt = 'd-mmm-yy';

        styleCell(dateCell, {
            size: 20,
            bold: true
        });
    });


    /* Building sections and venue rows */

    let rowNumber = 3;

    for (const group of groups) {

        sheet.mergeCells(
            `A${rowNumber}:H${rowNumber}`
        );

        const header = sheet.getCell(
            rowNumber, 1
        );

        header.value = group.title;

        styleCell(header, {
            size: 20,
            bold: true
        });

        header.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFFF00' }
        };

        sheet.getRow(rowNumber).height = 30;

        rowNumber++;

        for (const room of group.rooms) {

            const roomCell = sheet.getCell(
                rowNumber, 1
            );

            roomCell.value = room.label;

            styleCell(roomCell, {
                size: 20,
                align: 'left'
            });

            let rowHeight = Math.max(
                46,
                Math.ceil(
                    room.label.length / 25
                ) * 28
            );

            for (let day = 0; day < 7; day++) {

                const cell = sheet.getCell(
                    rowNumber, day + 2
                );

                const events = room.bookings[day]
                    .sort((a, b) =>
                        a.start - b.start
                    );

                const content = events.map(
                    booking => exportBookingText(
                        booking,
                        dates[day],
                        includeNotes
                    )
                ).join('\n\n');

                if (content.length > 32767) {
                    throw new Error(
                        'Too much text in ' +
                        room.label +
                        '. Try exporting without notes.'
                    );
                }

                // Stored as text, not an Excel formula.
                cell.value = content;

                styleCell(cell, { size: 18 });

                if (content) {
                    const lines = content
                        .split('\n')
                        .reduce(
                            (total, line) =>
                                total + Math.max(
                                    1,
                                    Math.ceil(
                                        line.length / 20
                                    )
                                ),
                            0
                        );

                    rowHeight = Math.max(
                        rowHeight,
                        lines * 25 + 12
                    );
                }
            }

            sheet.getRow(rowNumber).height =
                Math.min(409, rowHeight);

            rowNumber++;
        }
    }


    /* Print configuration */

    sheet.pageSetup.printArea =
        `A1:H${rowNumber - 1}`;

    sheet.pageSetup.printTitlesRow = '1:2';

    sheet.pageSetup.margins = {
        left: 0.25,
        right: 0.25,
        top: 0.3,
        bottom: 0.3,
        header: 0.1,
        footer: 0.1
    };


    /* Generate and download .xlsx */

    const buffer =
        await workbook.xlsx.writeBuffer();

    const blob = new Blob([buffer], {
        type:
            'application/vnd.openxmlformats-' +
            'officedocument.spreadsheetml.sheet'
    });

    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');

    link.href = url;

    link.download =
        `Room Booking Record ` +
        `${dates[0]} to ${dates[6]}.xlsx`;

    document.body.appendChild(link);

    link.click();
    link.remove();

    setTimeout(
        () => URL.revokeObjectURL(url),
        10000
    );
}


/* ==============================================
   Export panel controls
   ============================================== */

function updateExportWeekPreview() {
    try {
        const dates = getExportWeek(
            val('exportWeekDate')
        );

        el('exportWeekRange').value =
            exportDisplayDate(dates[0]) +
            ' - ' +
            exportDisplayDate(dates[6]);

        setText('weeklyExportMessage', '');

    } catch (err) {
        el('exportWeekRange').value = '';

        setText(
            'weeklyExportMessage',
            err.message,
            'error'
        );
    }
}


el('exportWeeklyBtn').addEventListener(
    'click',
    () => {
        const panel = el('weeklyExportPanel');

        panel.hidden = !panel.hidden;

        if (panel.hidden) return;

        if (!val('exportWeekDate')) {

            // Default to the upcoming Friday.
            const today = exportDateKey(new Date());

            const weekday = new Date(
                today + 'T00:00:00Z'
            ).getUTCDay();

            const daysUntilFriday =
                (5 - weekday + 7) % 7;

            el('exportWeekDate').value =
                exportAddDays(
                    today,
                    daysUntilFriday
                );
        }

        updateExportWeekPreview();
    }
);


el('closeWeeklyExport').addEventListener(
    'click',
    () => {
        el('weeklyExportPanel').hidden = true;
    }
);


el('exportWeekDate').addEventListener(
    'change',
    updateExportWeekPreview
);


/* ==============================================
   Download button
   ============================================== */

el('downloadWeeklyExcel').addEventListener(
    'click',
    async () => {

        const button = el('downloadWeeklyExcel');

        button.disabled = true;

        setText(
            'weeklyExportMessage',
            'Preparing weekly booking record...'
        );

        try {
            if (!token) {
                throw new Error('Please sign in.');
            }

            const exportSession = token;

            const dates = getExportWeek(
                val('exportWeekDate')
            );

            const includeNotes =
                el('exportIncludeNotes').checked;

            const weekStart = exportDayStart(
                dates[0]
            );

            const weekEnd = exportDayStart(
                exportAddDays(dates[6], 1)
            );


            // Retrieve fresh data from Google Sheets.
            const [data, venueData] =
                await Promise.all([
                    rpc('getBookings', {
                        status: 'approved'
                    }),
                    publicGet('getVenues')
                ]);

            if (!Array.isArray(data.bookings)) {
                throw new Error(
                    'Invalid booking response.'
                );
            }

            const rawVenues = Array.isArray(venueData)
                ? venueData
                : venueData.venues;

            if (!Array.isArray(rawVenues)) {
                throw new Error(
                    'Unable to retrieve venues.'
                );
            }

            const venueList = rawVenues
                .map(item =>
                    typeof item === 'string'
                        ? item.trim()
                        : String(
                            item.name ||
                            item.venue ||
                            item.location ||
                            ''
                        ).trim()
                )
                .filter(Boolean);


            // Include both booking types,
            // regardless of dashboard filters.
            const approved = data.bookings
                .map(normalizeBooking)
                .filter(b =>
                    b.status === 'approved'
                );

            const invalidBookings = approved.filter(
                b => !b.start ||
                    !b.end ||
                    b.end <= b.start
            );

            const bookings = approved.filter(b =>
                b.start &&
                b.end &&
                b.end > b.start &&
                b.start.getTime() < weekEnd &&
                b.end.getTime() > weekStart
            );

            if (!token || token !== exportSession) {
                throw new Error(
                    'Session changed. Please try again.'
                );
            }

            await generateWeeklyExcel(
                dates,
                bookings,
                venueList,
                includeNotes
            );

            let message =
                `Excel generated successfully. ` +
                `${bookings.length} approved bookings.`;

            if (invalidBookings.length) {
                message +=
                    ` Warning: ` +
                    `${invalidBookings.length} approved ` +
                    `records have invalid dates/times ` +
                    `and were excluded.`;
            }

            setText(
                'weeklyExportMessage',
                message,
                invalidBookings.length
                    ? 'error'
                    : 'success'
            );

        } catch (err) {

            setText(
                'weeklyExportMessage',
                err.message,
                'error'
            );

        } finally {
            button.disabled = false;
        }
    }
);