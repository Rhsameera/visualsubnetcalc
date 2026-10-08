let subnetMap = {};
let subnetNotes = {};
let maxNetSize = 0;
let infoColumnCount = 5
let showNetmask = false
let undoStack = []
let redoStack = []
let currentSnapshot = ''
// NORMAL mode:
//   - Smallest subnet: /32
//   - Two reserved addresses per subnet of size <= 30:
//     - Network Address (network + 0)
//     - Broadcast Address (last network address)
// AWS mode (future):
//   - Smallest subnet: /28
//   - Two reserved addresses per subnet:
//     - Network Address (network + 0)
//     - AWS Reserved - VPC Router
//     - AWS Reserved - VPC DNS
//     - AWS Reserved - Future Use
//     - Broadcast Address (last network address)
let operatingMode = 'NORMAL'
let noteTimeout;
let minSubnetSize = 32
let inflightColor = 'NONE'
let urlVersion = '1'
let configVersion = '1'

$('input#network,input#netsize').on('input', function() {
    $('#input_form')[0].classList.add('was-validated');
})

$('#color_palette div').on('click', function() {
    // We don't really NEED to convert this to hex, but it's really low overhead to do the
    // conversion here and saves us space in the export/save
    inflightColor = rgba2hex($(this).css('background-color'))
})

$('#calcbody').on('click', '.row_address, .row_range, .row_usable, .row_hosts, .note, input', function(event) {
    if (inflightColor !== 'NONE') {
        mutate_subnet_map('color', this.dataset.subnet, '', inflightColor)
        // We could re-render here, but there is really no point, keep performant and just change the background color now
        //renderTable();
        $(this).closest('tr').css('background-color', inflightColor)
        commit_history()
    }
})

$('#btn_go').on('click', function() {
    reset();
})

$('#importBtn').on('click', function() {
    let parsed
    try {
        parsed = JSON.parse($('#importExportArea').val())
    } catch (e) {
        report_import_error('The pasted text is not valid JSON.')
        return
    }
    if (importConfig(parsed)) {
        bootstrap.Modal.getInstance(document.getElementById('importExportModal'))?.hide()
    }
})

$('#bottom_nav #colors_word_open').on('click', function() {
    $('#bottom_nav #color_palette').removeClass('d-none');
    $('#bottom_nav #colors_word_close').removeClass('d-none');
    $('#bottom_nav #colors_word_open').addClass('d-none');
})

$('#bottom_nav #colors_word_close').on('click', function() {
    $('#bottom_nav #color_palette').addClass('d-none');
    $('#bottom_nav #colors_word_close').addClass('d-none');
    $('#bottom_nav #colors_word_open').removeClass('d-none');
    inflightColor = 'NONE'
})

$('#bottom_nav #copy_url').on('click', function() {
    let url = window.location.origin + getConfigUrl()
    if (url.length > 2000) {
        show_warning_modal('This shareable URL is ' + url.length + ' characters long. Some browsers, servers and chat tools truncate URLs over 2000 characters, so the link may not work. Use Tools &gt; Import / Export to share the design as JSON instead.')
    }
    navigator.clipboard.writeText(url);
    $('#bottom_nav #copy_url span').text('Copied!')
    // Swap the text back after 3sec
    setTimeout(function(){
        $('#bottom_nav #copy_url span').text('Copy Shareable URL')
    }, 2000)
})


$('#btn_import_export').on('click', function() {
    $('#importError').addClass('d-none')
    $('#importExportArea').val(JSON.stringify(exportConfig(), null, 2))
})

function reset() {
    if (operatingMode === 'AWS') {
        minSubnetSize = 28
    } else {
        minSubnetSize = 32
    }
    let maxRootSize = Math.min(30, minSubnetSize)
    let networkValue = $('#network').val().trim()
    let netsizeValue = $('#netsize').val().trim()
    if (!is_valid_ipv4(networkValue)) {
        show_warning_modal('Please enter a valid IPv4 network address, e.g. <span class="font-monospace">10.0.0.0</span>.')
        return
    }
    if (!/^\d{1,2}$/.test(netsizeValue) || parseInt(netsizeValue) > maxRootSize) {
        show_warning_modal('Network size must be a number between 0 and ' + maxRootSize + (operatingMode === 'AWS' ? ' in AWS mode.' : '.'))
        return
    }
    $('#network').val(networkValue)
    $('#netsize').val(parseInt(netsizeValue))
    let cidrInput = $('#network').val() + '/' + $('#netsize').val()
    let rootNetwork = get_network($('#network').val(), $('#netsize').val())
    let rootCidr = rootNetwork + '/' + $('#netsize').val()
    if (cidrInput !== rootCidr) {
        show_warning_modal('<div>Your network input is not on a network boundary for this network size. It has been automatically changed:</div><div class="font-monospace pt-2">' + $('#network').val() + ' -> ' + rootNetwork + '</div>')
    }
    $('#network').val(rootNetwork)
    subnetMap = {}
    subnetMap[rootCidr] = {}
    maxNetSize = parseInt($('#netsize').val())
    commit_history()
    renderTable();
}

$('#calcbody').on('click', 'td.split,td.join', function(event) {
    // HTML DOM Data elements! Yay! See the `data-*` attributes of the HTML tags
    mutate_subnet_map(this.dataset.mutateVerb, this.dataset.subnet, '')
    commit_history()
    renderTable();
})

// Right-click a Split cell to split a subnet into several equal pieces at once.
let splitTargetSubnet = ''
$('#calcbody').on('contextmenu', 'td.split', function(event) {
    let parts = this.dataset.subnet.split('/')
    let netSize = parseInt(parts[1])
    let options = ''
    for (let bits = 1; bits <= 8 && netSize + bits <= minSubnetSize; bits++) {
        options += '<option value="' + (netSize + bits) + '">' + (2 ** bits) + ' x /' + (netSize + bits) + '</option>'
    }
    if (options === '') { return }
    event.preventDefault()
    splitTargetSubnet = this.dataset.subnet
    $('#splitSubnetLabel').text(splitTargetSubnet)
    $('#splitSizeSelect').html(options)
    bootstrap.Modal.getOrCreateInstance(document.getElementById('splitModal')).show()
})

$('#splitConfirmBtn').on('click', function() {
    split_network_to(splitTargetSubnet, parseInt($('#splitSizeSelect').val()))
    commit_history()
    renderTable()
    bootstrap.Modal.getOrCreateInstance(document.getElementById('splitModal')).hide()
})

$('#calcbody').on('keyup', 'td.note input', function(event) {
    // HTML DOM Data elements! Yay! See the `data-*` attributes of the HTML tags
    let delay = 1000;
    clearTimeout(noteTimeout);
    noteTimeout = setTimeout(function(element) {
        mutate_subnet_map('note', element.dataset.subnet, '', element.value)
        commit_history()
    }, delay, this);
})

$('#calcbody').on('focusout', 'td.note input', function(event) {
    // HTML DOM Data elements! Yay! See the `data-*` attributes of the HTML tags
    clearTimeout(noteTimeout);
    mutate_subnet_map('note', this.dataset.subnet, '', this.value)
    commit_history()
})


function renderTable() {
    infoColumnCount = showNetmask ? 6 : 5
    $('#netmaskHeader').css('display', showNetmask ? 'table-cell' : 'none')
    $('#calcbody').empty();
    let maxDepth = get_dict_max_depth(subnetMap, 0)
    addRowTree(subnetMap, 0, maxDepth)
}

function addRowTree(subnetTree, depth, maxDepth) {
    for (let mapKey in subnetTree) {
        if (mapKey.startsWith('_')) { continue; }
        if (has_network_sub_keys(subnetTree[mapKey])) {
            addRowTree(subnetTree[mapKey], depth + 1, maxDepth)
        } else {
            let subnet_split = mapKey.split('/')
            let notesWidth = '30%';
            if ((maxDepth > 5) && (maxDepth <= 10)) {
                notesWidth = '25%';
            } else if ((maxDepth > 10) && (maxDepth <= 15)) {
                notesWidth = '20%';
            } else if ((maxDepth > 15) && (maxDepth <= 20)) {
                notesWidth = '15%';
            } else if (maxDepth > 20) {
                notesWidth = '10%';
            }
            addRow(subnet_split[0], parseInt(subnet_split[1]), (infoColumnCount + maxDepth - depth), (subnetTree[mapKey]['_note'] || ''), notesWidth, (subnetTree[mapKey]['_color'] || ''))
        }
    }
}

function addRow(network, netSize, colspan, note, notesWidth, color) {
    let addressFirst = ip2int(network)
    let addressLast = subnet_last_address(addressFirst, netSize)
    let usableFirst = subnet_usable_first(addressFirst, netSize, operatingMode)
    let usableLast = subnet_usable_last(addressFirst, netSize)
    let hostCount = 1 + usableLast - usableFirst
    let styleTag = ''
    if (is_valid_color(color)) {
        styleTag = ' style="background-color: ' + color + '"'
    }
    note = escapeHtml(note)

    let rangeCol, usableCol;
    if (netSize < 32) {
        rangeCol = int2ip(addressFirst) + ' - ' + int2ip(addressLast);
        usableCol = int2ip(usableFirst) + ' - ' + int2ip(usableLast);
    } else {
        rangeCol = int2ip(addressFirst);
        usableCol = int2ip(usableFirst);
    }

    let newRow =
        '            <tr id="row_' + network.replace('.', '-') + '_' + netSize + '"' + styleTag + '>\n' +
        '                <td data-subnet="' + network + '/' + netSize + '" class="row_address">' + network + '/' + netSize + '</td>\n' +
        (showNetmask ? '                <td data-subnet="' + network + '/' + netSize + '" class="row_netmask">' + netmask_text(netSize) + '</td>\n' : '') +
        '                <td data-subnet="' + network + '/' + netSize + '" class="row_range">' + rangeCol + '</td>\n' +
        '                <td data-subnet="' + network + '/' + netSize + '" class="row_usable">' + usableCol + '</td>\n' +
        '                <td data-subnet="' + network + '/' + netSize + '" class="row_hosts">' + hostCount + '</td>\n' +
        '                <td class="note" style="width:' + notesWidth + '"><label><input type="text" class="form-control shadow-none p-0" data-subnet="' + network + '/' + netSize + '" value="' + note + '"></label></td>\n' +
        '                <td rowspan="1" colspan="' + colspan + '" class="split rotate" data-subnet="' + network + '/' + netSize + '" data-mutate-verb="split"><span>/' + netSize + '</span></td>\n'
    if (netSize > maxNetSize) {
        // This is wrong. Need to figure out a way to get the number of children so you can set rowspan and the number
        // of ancestors so you can set colspan.
        // DONE: If the subnet address (without the mask) matches a larger subnet address
        // in the heirarchy that is a signal to add more join buttons to that row, since they start at the top row and
        // via rowspan extend downward.
        let matchingNetworkList = get_matching_network_list(network, subnetMap).slice(1)
        for (const i in matchingNetworkList) {
            let matchingNetwork = matchingNetworkList[i]
            let networkChildrenCount = count_network_children(matchingNetwork, subnetMap, [])
            newRow += '                <td rowspan="' + networkChildrenCount + '" colspan="1" class="join rotate" data-subnet="' + matchingNetwork + '" data-mutate-verb="join"><span>/' + matchingNetwork.split('/')[1] + '</span></td>\n'
        }
    }
    newRow += '            </tr>';

    $('#calcbody').append(newRow)
}


// Helper Functions
function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function(c) {
        return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]
    })
}

function is_valid_ipv4(ip) {
    return /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(ip)
}

function is_valid_cidr(cidr) {
    if (typeof cidr !== 'string') { return false }
    let parts = cidr.split('/')
    return parts.length === 2 && is_valid_ipv4(parts[0]) && /^\d{1,2}$/.test(parts[1]) && parseInt(parts[1]) <= 32
}

function is_valid_color(color) {
    return typeof color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(color)
}

// Throws if the (decoded) config tree is malformed, so bad imports/URLs can never reach the renderer.
function validate_subnet_tree(tree, isRoot) {
    if (typeof tree !== 'object' || tree === null || Array.isArray(tree)) {
        throw new Error('Invalid subnet structure.')
    }
    let keys = Object.keys(tree)
    if (isRoot && keys.length !== 1) {
        throw new Error('Configuration must have exactly one root network.')
    }
    for (const key of keys) {
        if (key === '_note') {
            if (typeof tree[key] !== 'string') { throw new Error('Invalid note.') }
        } else if (key === '_color') {
            if (tree[key] !== '' && !is_valid_color(tree[key])) { throw new Error('Invalid color.') }
        } else if (is_valid_cidr(key)) {
            validate_subnet_tree(tree[key], false)
        } else {
            throw new Error('Invalid subnet "' + key + '".')
        }
    }
}

function ip2int(ip) {
    return ip.split('.').reduce(function(ipInt, octet) { return (ipInt<<8) + parseInt(octet, 10)}, 0) >>> 0;
}

function int2ip (ipInt) {
    return ( (ipInt>>>24) +'.' + (ipInt>>16 & 255) +'.' + (ipInt>>8 & 255) +'.' + (ipInt & 255) );
}

function subnet_last_address(subnet, netSize) {
    return subnet + subnet_addresses(netSize) - 1;
}

function subnet_addresses(netSize) {
    return 2**(32-netSize);
}

function subnet_usable_first(network, netSize, operatingMode) {
    if (netSize < 31) {
        // https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html
        // AWS reserves 3 additional IPs
        return network + (operatingMode === 'AWS' ? 4 : 1);
    } else {
        return network;
    }
}

function subnet_usable_last(network, netSize) {
    let last_address = subnet_last_address(network, netSize);
    if (netSize < 31) {
        return last_address - 1;
    } else {
        return last_address;
    }
}

function get_dict_max_depth(dict, curDepth) {
    let maxDepth = curDepth
    for (let mapKey in dict) {
        if (mapKey.startsWith('_')) { continue; }
        let newDepth = get_dict_max_depth(dict[mapKey], curDepth + 1)
        if (newDepth > maxDepth) { maxDepth = newDepth }
    }
    return maxDepth
}


function get_join_children(subnetTree, childCount) {
    for (let mapKey in subnetTree) {
        if (mapKey.startsWith('_')) { continue; }
        if (has_network_sub_keys(subnetTree[mapKey])) {
            childCount += get_join_children(subnetTree[mapKey])
        } else {
            return childCount
        }
    }
}

function has_network_sub_keys(dict) {
    let allKeys = Object.keys(dict)
    // Maybe an efficient way to do this with a Lambda?
    for (let i in allKeys) {
        if (!allKeys[i].startsWith('_')) {
            return true
        }
    }
    return false
}

function count_network_children(network, subnetTree, ancestryList) {
    // TODO: This might be able to be optimized. Ultimately it needs to count the number of keys underneath
    // the current key are unsplit networks (IE rows in the table, IE keys with a value of {}).
    let childCount = 0
    for (let mapKey in subnetTree) {
        if (mapKey.startsWith('_')) { continue; }
        if (has_network_sub_keys(subnetTree[mapKey])) {
            childCount += count_network_children(network, subnetTree[mapKey], ancestryList.concat([mapKey]))
        } else {
            if (ancestryList.includes(network)) {
                childCount += 1
            }
        }
    }
    return childCount
}

function get_network_children(network, subnetTree) {
    // TODO: This might be able to be optimized. Ultimately it needs to count the number of keys underneath
    // the current key are unsplit networks (IE rows in the table, IE keys with a value of {}).
    let subnetList = []
    for (let mapKey in subnetTree) {
        if (mapKey.startsWith('_')) { continue; }
        if (has_network_sub_keys(subnetTree[mapKey])) {
            subnetList.push.apply(subnetList, get_network_children(network, subnetTree[mapKey]))
        } else {
            subnetList.push(mapKey)
        }
    }
    return subnetList
}

function get_matching_network_list(network, subnetTree) {
    let subnetList = []
    for (let mapKey in subnetTree) {
        if (mapKey.startsWith('_')) { continue; }
        if (has_network_sub_keys(subnetTree[mapKey])) {
            subnetList.push.apply(subnetList, get_matching_network_list(network, subnetTree[mapKey]))
        }
        if (mapKey.split('/')[0] === network) {
            subnetList.push(mapKey)
        }
    }
    return subnetList
}

function get_consolidated_property(subnetTree, property) {
    let allValues = get_property_values(subnetTree, property)
    // https://stackoverflow.com/questions/14832603/check-if-all-values-of-array-are-equal
    let allValuesMatch = allValues.every( (val, i, arr) => val === arr[0] )
    if (allValuesMatch) {
        return allValues[0]
    } else {
        return ''
    }
}

function get_property_values(subnetTree, property) {
    let propValues = []
    for (let mapKey in subnetTree) {
        if (has_network_sub_keys(subnetTree[mapKey])) {
            propValues.push.apply(propValues, get_property_values(subnetTree[mapKey], property))
        } else {
            // The "else" above is a bit different because it will start tracking values for subnets which are
            // in the hierarchy, but not displayed. Those are always blank so it messes up the value list
            propValues.push(subnetTree[mapKey][property] || '')
        }
    }
    return propValues
}

function get_network(networkInput, netSize) {
    let ipInt = ip2int(networkInput)
    netSize = parseInt(netSize)
    let mask = netSize === 0 ? 0 : (0xFFFFFFFF << (32 - netSize)) >>> 0
    return int2ip((ipInt & mask) >>> 0);
}

function split_network(networkInput, netSize) {
    let subnets = [networkInput + '/' + (netSize + 1)]
    let newSubnet = ip2int(networkInput) + 2**(32-netSize-1);
    subnets.push(int2ip(newSubnet) + '/' + (netSize + 1))
    return subnets;
}

function mutate_subnet_map(verb, network, subnetTree, propValue = '') {
    if (subnetTree === '') { subnetTree = subnetMap }
    for (let mapKey in subnetTree) {
        if (mapKey.startsWith('_')) { continue; }
        if (has_network_sub_keys(subnetTree[mapKey])) {
            mutate_subnet_map(verb, network, subnetTree[mapKey], propValue)
        }
        if (mapKey === network) {
            let netSplit = mapKey.split('/')
            let netSize = parseInt(netSplit[1])
            if (verb === 'split') {
                if (netSize < minSubnetSize) {
                    let new_networks = split_network(netSplit[0], netSize)
                    // Could maybe optimize this for readability with some null coalescing
                    subnetTree[mapKey][new_networks[0]] = {}
                    subnetTree[mapKey][new_networks[1]] = {}
                    // Options:
                    //   [ Selected ] Copy note to both children and delete parent note
                    //   [ Possible ] Blank out the new and old subnet notes
                    if (subnetTree[mapKey].hasOwnProperty('_note')) {
                        subnetTree[mapKey][new_networks[0]]['_note'] = subnetTree[mapKey]['_note']
                        subnetTree[mapKey][new_networks[1]]['_note'] = subnetTree[mapKey]['_note']
                    }
                    delete subnetTree[mapKey]['_note']
                    if (subnetTree[mapKey].hasOwnProperty('_color')) {
                        subnetTree[mapKey][new_networks[0]]['_color'] = subnetTree[mapKey]['_color']
                        subnetTree[mapKey][new_networks[1]]['_color'] = subnetTree[mapKey]['_color']
                    }
                    delete subnetTree[mapKey]['_color']
                }
            } else if (verb === 'join') {
                // Options:
                //   [ Selected ] Keep note if all the notes are the same, blank them out if they differ. Most intuitive
                //   [ Possible ] Lose note data for all deleted subnets.
                //   [ Possible ] Keep note from first subnet in the join scope. Reasonable but I think rarely will the note be kept by the user
                //   [ Possible ] Concatenate all notes. Ugly and won't really be useful for more than two subnets being joined
                subnetTree[mapKey] = {
                    '_note': get_consolidated_property(subnetTree[mapKey], '_note'),
                    '_color': get_consolidated_property(subnetTree[mapKey], '_color')
                }
            } else if (verb === 'note') {
                subnetTree[mapKey]['_note'] = propValue
            } else if (verb === 'color') {
                subnetTree[mapKey]['_color'] = propValue
            } else {
                // How did you get here?
            }
        }
    }
}


function show_warning_modal(message) {
    var notifyModal = new bootstrap.Modal(document.getElementById("notifyModal"), {});
    $('#notifyModal .modal-body').html(message)
    notifyModal.show()
}

$( document ).ready(function() {
    let autoConfigResult = processConfigUrl();
    if (!autoConfigResult) {
        reset();
    }
    //importConfig('{"config_version":"1","subnets":{"10.0.0.0/16":{"10.0.0.0/17":{"10.0.0.0/18":{},"10.0.64.0/18":{}},"10.0.128.0/17":{"10.0.128.0/18":{"10.0.128.0/19":{},"10.0.160.0/19":{"10.0.160.0/20":{"10.0.160.0/21":{"10.0.160.0/22":{},"10.0.164.0/22":{}},"10.0.168.0/21":{}},"10.0.176.0/20":{"10.0.176.0/21":{"10.0.176.0/22":{"10.0.176.0/23":{},"10.0.178.0/23":{}},"10.0.180.0/22":{}},"10.0.184.0/21":{}}}},"10.0.192.0/18":{"10.0.192.0/19":{},"10.0.224.0/19":{}}}}},"notes":{}}')
    //importConfig('{"config_version":"1","subnets":{"10.0.0.0/16":{"10.0.0.0/17":{"10.0.0.0/18":{"_note":"Note 1"},"10.0.64.0/18":{"_note":"Note 2"}},"10.0.128.0/17":{"10.0.128.0/18":{"10.0.128.0/19":{"_note":"Note 3"},"10.0.160.0/19":{"10.0.160.0/20":{"10.0.160.0/21":{"10.0.160.0/22":{"_note":"Note 4"},"10.0.164.0/22":{"_note":"Note 5"}},"10.0.168.0/21":{"_note":"Note 6"}},"10.0.176.0/20":{"10.0.176.0/21":{"10.0.176.0/22":{"10.0.176.0/23":{"_note":"Note 7"},"10.0.178.0/23":{"_note":"Note 8"}},"10.0.180.0/22":{"_note":"Note 9"}},"10.0.184.0/21":{"_note":"Note 10"}}}},"10.0.192.0/18":{"10.0.192.0/19":{"_note":"Note 11"},"10.0.224.0/19":{"_note":"Note 12"}}}}},"notes":{}}')
});

function exportConfig() {
    return {
        'config_version': configVersion,
        'subnets': subnetMap,
    }
}

function getConfigUrl() {
    let defaultExport = JSON.parse(JSON.stringify(exportConfig()));
    renameKey(defaultExport, 'config_version', 'v')
    renameKey(defaultExport, 'subnets', 's')
    shortenKeys(defaultExport['s'])
    return '/index.html?c=' + urlVersion + LZString.compressToEncodedURIComponent(JSON.stringify(defaultExport))
}

function processConfigUrl() {
    const params = new Proxy(new URLSearchParams(window.location.search), {
        get: (searchParams, prop) => searchParams.get(prop),
    });
    if (params['c'] !== null) {
        // First character is the version of the URL string, in case the mechanism of encoding changes
        let urlVersion = params['c'].substring(0, 1)
        let urlData = params['c'].substring(1)
        if (urlVersion === '1') {
            try {
                let urlConfig = JSON.parse(LZString.decompressFromEncodedURIComponent(urlData))
                renameKey(urlConfig, 'v', 'config_version')
                renameKey(urlConfig, 's', 'subnets')
                expandKeys(urlConfig['subnets'])
                return importConfig(urlConfig)
            } catch (e) {
                show_warning_modal('The shared link could not be read. It may be truncated or corrupt.')
                return false
            }
        }
    }
}

function shortenKeys(subnetTree) {
    for (let mapKey in subnetTree) {
        if (mapKey.startsWith('_')) {
            continue;
        }
        if (has_network_sub_keys(subnetTree[mapKey])) {
            shortenKeys(subnetTree[mapKey])
        } else {
            if (subnetTree[mapKey].hasOwnProperty('_note')) {
                renameKey(subnetTree[mapKey], '_note', '_n')
            }
            if (subnetTree[mapKey].hasOwnProperty('_color')) {
                renameKey(subnetTree[mapKey], '_color', '_c')
            }

        }
    }
}

function expandKeys(subnetTree) {
    for (let mapKey in subnetTree) {
        if (mapKey.startsWith('_')) {
            continue;
        }
        if (has_network_sub_keys(subnetTree[mapKey])) {
            expandKeys(subnetTree[mapKey])
        } else {
            if (subnetTree[mapKey].hasOwnProperty('_n')) {
                renameKey(subnetTree[mapKey], '_n', '_note')
            }
            if (subnetTree[mapKey].hasOwnProperty('_c')) {
                renameKey(subnetTree[mapKey], '_c', '_color')
            }

        }
    }
}


function renameKey(obj, oldKey, newKey) {
    if (oldKey !== newKey) {
    Object.defineProperty(obj, newKey,
        Object.getOwnPropertyDescriptor(obj, oldKey));
        delete obj[oldKey];
    }
}

// Bootstrap would stack a second modal behind the Import dialog, so show errors inline there.
function report_import_error(message) {
    if ($('#importExportModal').hasClass('show')) {
        $('#importError').text(message).removeClass('d-none')
    } else {
        show_warning_modal(escapeHtml(message))
    }
}

function importConfig(text) {
    try {
        if (typeof text !== 'object' || text === null || text['config_version'] !== '1') {
            throw new Error('Unsupported or missing config_version.')
        }
        validate_subnet_tree(text['subnets'], true)
        let rootCidr = Object.keys(text['subnets'])[0]
        let subnet_split = rootCidr.split('/')
        if (get_network(subnet_split[0], subnet_split[1]) !== subnet_split[0]) {
            throw new Error('Root network is not on a network boundary.')
        }
        $('#network').val(subnet_split[0])
        $('#netsize').val(subnet_split[1])
        subnetMap = text['subnets'];
        maxNetSize = parseInt(subnet_split[1])
        commit_history()
        renderTable()
        return true
    } catch (e) {
        report_import_error('Import failed: ' + e.message)
        return false
    }
}

$('#btn_aws_mode').on('click', function(event) {
    event.preventDefault()
    operatingMode = (operatingMode === 'AWS') ? 'NORMAL' : 'AWS'
    $('#aws_mode_state').text(operatingMode === 'AWS' ? 'on' : 'off')
    reset()
})

const rgba2hex = (rgba) => `#${rgba.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+\.{0,1}\d*))?\)$/).slice(1).map((n, i) => (i === 3 ? Math.round(parseFloat(n) * 255) : parseFloat(n)).toString(16).padStart(2, '0').replace('NaN', '')).join('')}`

// Netmask / wildcard column
function netmask_text(netSize) {
    let mask = netSize === 0 ? 0 : (0xFFFFFFFF << (32 - netSize)) >>> 0
    return int2ip(mask) + ' / ' + int2ip(~mask >>> 0)
}

$('#btn_netmask').on('click', function(event) {
    event.preventDefault()
    showNetmask = !showNetmask
    $('#netmask_state').text(showNetmask ? 'on' : 'off')
    renderTable()
})

// Undo / redo: snapshots of the whole subnet tree
function commit_history() {
    let snapshot = JSON.stringify(subnetMap)
    if (snapshot === currentSnapshot) { return }
    if (currentSnapshot !== '') {
        undoStack.push(currentSnapshot)
        if (undoStack.length > 100) { undoStack.shift() }
    }
    currentSnapshot = snapshot
    redoStack = []
    update_history_buttons()
}

function restore_snapshot(snapshot) {
    currentSnapshot = snapshot
    subnetMap = JSON.parse(snapshot)
    let rootSplit = Object.keys(subnetMap)[0].split('/')
    maxNetSize = parseInt(rootSplit[1])
    $('#network').val(rootSplit[0])
    $('#netsize').val(rootSplit[1])
    renderTable()
    update_history_buttons()
}

function undo() {
    if (undoStack.length === 0) { return }
    redoStack.push(currentSnapshot)
    restore_snapshot(undoStack.pop())
}

function redo() {
    if (redoStack.length === 0) { return }
    undoStack.push(currentSnapshot)
    restore_snapshot(redoStack.pop())
}

function update_history_buttons() {
    $('#btn_undo').toggleClass('disabled', undoStack.length === 0)
    $('#btn_redo').toggleClass('disabled', redoStack.length === 0)
}

$('#btn_undo').on('click', function(event) { event.preventDefault(); undo() })
$('#btn_redo').on('click', function(event) { event.preventDefault(); redo() })

$(document).on('keydown', function(event) {
    if (!(event.ctrlKey || event.metaKey)) { return }
    // Leave text editing inside inputs/textareas to the browser
    if ($(event.target).is('input, textarea')) { return }
    let key = event.key.toLowerCase()
    if (key === 'z' && !event.shiftKey) { event.preventDefault(); undo() }
    else if (key === 'y' || (key === 'z' && event.shiftKey)) { event.preventDefault(); redo() }
})

// Split a subnet into equal pieces of the target size
function split_network_to(cidr, targetSize) {
    let level = [cidr]
    while (level.length > 0 && parseInt(level[0].split('/')[1]) < targetSize) {
        let next = []
        for (const net of level) {
            let parts = net.split('/')
            mutate_subnet_map('split', net, '')
            next.push(...split_network(parts[0], parseInt(parts[1])))
        }
        level = next
    }
}

// Table export (CSV / Markdown / JSON file)
function get_table_data() {
    let rows = [['Subnet', 'Range', 'Usable', 'Hosts', 'Note']]
    if (showNetmask) { rows[0].splice(1, 0, 'Netmask / Wildcard') }
    $('#calcbody tr').each(function() {
        let row = [$(this).find('.row_address').text()]
        if (showNetmask) { row.push($(this).find('.row_netmask').text()) }
        row.push($(this).find('.row_range').text(), $(this).find('.row_usable').text(), $(this).find('.row_hosts').text(), $(this).find('td.note input').val())
        rows.push(row)
    })
    return rows
}

function to_csv(rows) {
    return rows.map(function(row) {
        return row.map(function(cell) {
            cell = String(cell)
            // Prevent spreadsheet formula injection from notes
            if (/^[=+\-@\t\r]/.test(cell)) { cell = "'" + cell }
            return '"' + cell.replace(/"/g, '""') + '"'
        }).join(',')
    }).join('\r\n') + '\r\n'
}

function to_markdown(rows) {
    let esc = function(cell) { return String(cell).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ') }
    let lines = ['| ' + rows[0].map(esc).join(' | ') + ' |', '| ' + rows[0].map(function() { return '---' }).join(' | ') + ' |']
    rows.slice(1).forEach(function(row) { lines.push('| ' + row.map(esc).join(' | ') + ' |') })
    return lines.join('\n') + '\n'
}

function download_file(filename, content, mime) {
    let url = URL.createObjectURL(new Blob([content], {type: mime}))
    let link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
}

$('#btn_export_csv').on('click', function() { download_file('subnets.csv', to_csv(get_table_data()), 'text/csv') })
$('#btn_export_json').on('click', function() { download_file('subnets.json', JSON.stringify(exportConfig(), null, 2), 'application/json') })
$('#btn_copy_markdown').on('click', function() {
    navigator.clipboard.writeText(to_markdown(get_table_data()))
    $('#btn_copy_markdown').text('Copied!')
    setTimeout(function() { $('#btn_copy_markdown').text('Copy Markdown') }, 2000)
})
$('#importFile').on('change', function() {
    let file = this.files[0]
    if (!file) { return }
    let reader = new FileReader()
    reader.onload = function() { $('#importExportArea').val(reader.result) }
    reader.readAsText(file)
    this.value = ''
})

// VLSM planner: allocate subnets for a list of host requirements inside the current root network
function usable_hosts(netSize) {
    let total = 2 ** (32 - netSize)
    if (netSize >= 31) { return total }
    return total - (operatingMode === 'AWS' ? 5 : 2)
}

function parse_vlsm_requests(text) {
    let requests = []
    let lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim()
        if (line === '') { continue }
        let match = line.match(/^(?:(.*?)\s*[,:\t]\s*)?(\d+)$/)
        if (!match) { throw new Error('Line ' + (i + 1) + ' is not "name, hosts" or a host count.') }
        let hosts = parseInt(match[2])
        if (hosts < 1 || hosts > 2 ** 32) { throw new Error('Line ' + (i + 1) + ': host count out of range.') }
        requests.push({name: match[1] || '', hosts: hosts})
    }
    if (requests.length === 0) { throw new Error('Enter at least one subnet requirement.') }
    if (requests.length > 500) { throw new Error('Too many subnets (max 500).') }
    return requests
}

function build_vlsm_tree(rootAddr, rootSize, requests) {
    let sized = requests.map(function(req, index) {
        let prefix = -1
        for (let candidate = Math.min(minSubnetSize, 32); candidate >= rootSize; candidate--) {
            if (usable_hosts(candidate) >= req.hosts) { prefix = candidate; break }
        }
        if (prefix === -1) { throw new Error('"' + (req.name || req.hosts + ' hosts') + '" needs more hosts than this network can hold.') }
        return {prefix: prefix, name: req.name, hosts: req.hosts, index: index}
    })
    // Largest first keeps every block naturally aligned and leaves no gaps
    sized.sort(function(a, b) { return a.prefix - b.prefix || a.index - b.index })
    let leaves = {}
    let cursor = rootAddr
    let end = rootAddr + 2 ** (32 - rootSize)
    for (const item of sized) {
        let size = 2 ** (32 - item.prefix)
        if (cursor + size > end) { throw new Error('The requested subnets do not fit in ' + int2ip(rootAddr) + '/' + rootSize + '.') }
        let note = item.name ? item.name + ' (' + item.hosts + ' hosts)' : item.hosts + ' hosts'
        leaves[int2ip(cursor) + '/' + item.prefix] = note
        cursor += size
    }
    // Remaining space becomes maximal aligned free blocks
    while (cursor < end) {
        let size = 1
        while (cursor % (size * 2) === 0 && cursor + size * 2 <= end) { size *= 2 }
        leaves[int2ip(cursor) + '/' + (32 - Math.log2(size))] = ''
        cursor += size
    }
    let build = function(addr, size) {
        let cidr = int2ip(addr) + '/' + size
        if (cidr in leaves) {
            return leaves[cidr] === '' ? {} : {'_note': leaves[cidr]}
        }
        let half = 2 ** (32 - size - 1)
        let node = {}
        node[int2ip(addr) + '/' + (size + 1)] = build(addr, size + 1)
        node[int2ip(addr + half) + '/' + (size + 1)] = build(addr + half, size + 1)
        return node
    }
    let tree = {}
    tree[int2ip(rootAddr) + '/' + rootSize] = build(rootAddr, rootSize)
    return tree
}

$('#btn_vlsm').on('click', function(event) {
    event.preventDefault()
    let rootCidr = Object.keys(subnetMap)[0]
    $('#vlsmRoot').text(rootCidr)
    $('#vlsmError').addClass('d-none')
    bootstrap.Modal.getOrCreateInstance(document.getElementById('vlsmModal')).show()
})

$('#vlsmApplyBtn').on('click', function() {
    try {
        let rootSplit = Object.keys(subnetMap)[0].split('/')
        let requests = parse_vlsm_requests($('#vlsmInput').val())
        let tree = build_vlsm_tree(ip2int(rootSplit[0]), parseInt(rootSplit[1]), requests)
        validate_subnet_tree(tree, true)
        subnetMap = tree
        commit_history()
        renderTable()
        bootstrap.Modal.getOrCreateInstance(document.getElementById('vlsmModal')).hide()
    } catch (e) {
        $('#vlsmError').text(e.message).removeClass('d-none')
    }
})
